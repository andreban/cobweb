// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

const RAW_BANNER = 'raw REPL; CTRL-B to exit\r\n>';
const OK = 'OK';
const EOT = 0x04;

export interface RunResult {
  stdout: string;
  stderr: string;
}

interface ResponseParser {
  feed(chunk: Uint8Array): void;
  abort(reason: unknown): void;
}

/**
 * An implementation of the MicroPython REPL interface. Documentation for the interface itself
 * is available at https://docs.micropython.org/en/latest/reference/repl.html.
 */
export class ReplInterface extends EventTarget {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private encoder = new TextEncoder();
  // Tail of the write-serialization chain. Public write methods (`send`,
  // `sendRaw`, `reset`) chain off this so each runs to completion before the
  // next begins, preventing one caller's prologue from interleaving with
  // another's body in the underlying WritableStream queue.
  private writeChain: Promise<void> = Promise.resolve();
  // Active raw-REPL response parser. The read loop hands every incoming chunk
  // to it (in addition to dispatching the `'data'` event). At most one parser
  // is active because `sendRaw` runs under the write-serialization mutex.
  private parser: ResponseParser | null = null;

  constructor(private port: SerialPort) {
    super();
    this.writer = port.writable.getWriter()
    this.reader = port.readable.getReader();
    // Safety net: readLoop already catches its own errors, but if anything
    // ever escapes, surface it instead of leaving an unhandled rejection.
    this.readLoop().catch((error) => {
      this.dispatchEvent(new CustomEvent('disconnect', {detail: {error}}));
    });
  }

  /**
   * Runs `task` mutually exclusive with every other call routed through this
   * method. Failures of one task don't break the chain — the next task still
   * runs — but they do propagate to the caller of the failing task.
   */
  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(task);
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readLoop() {
    let error: unknown;
    try {
      while (true) {
        const {value, done} = await this.reader.read();
        if (value) {
          this.dispatchEvent(new CustomEvent('data', {detail: value}));
          this.parser?.feed(value);
        }
        if (done) {
          break;
        }
      }
    } catch (err) {
      error = err;
    } finally {
      try {
        this.reader.releaseLock();
      } catch {
        // Already released or stream is in an error state.
      }
    }
    // If a sendRaw was waiting for a response, surface the disconnect to it
    // before firing the public event so callers see a real rejection instead
    // of hanging until their timeout.
    this.parser?.abort(error ?? new Error('disconnected'));
    this.dispatchEvent(
      new CustomEvent('disconnect', error ? {detail: {error}} : undefined),
    );
  }

  async disconnect() {
    await this.writer.close();
    await this.reader.cancel();
    await this.port.close();
  }

  reset() {
    return this.runExclusive(async () => {
      // ctrl-C twice: interrupt any running program
      await this.writer.write(Uint8Array.from([0x03, 0x03]));

      // Ctrl-A: enter raw REPL
      await this.writer.write(Uint8Array.from([0x01]));

      //  ctrl-D: soft reset
      await this.writer.write(Uint8Array.from([0x04]));

      // ctrl+B: exit raw REPL
      await this.writer.write(Uint8Array.from([0x02]));
    });
  }

  send(content: string) {
    return this.runExclusive(async () => {
      await this.writer.write(this.encoder.encode(content));
    });
  }

  /**
   * Runs `content` in the device's raw REPL and returns its captured stdout
   * and stderr. The raw protocol (per the MicroPython docs) is:
   *
   *   1. Ctrl-A  → device emits `\r\nraw REPL; CTRL-B to exit\r\n>`.
   *   2. code + Ctrl-D → device emits `OK`, then stdout, `\x04`, stderr, `\x04`, `>`.
   *
   * Bytes are still dispatched via the `'data'` event so xterm mirrors the
   * full conversation; the parser only inspects them.
   *
   * Rejects if `timeoutMs` elapses before both `\x04` framing bytes arrive,
   * or if the connection drops mid-flight.
   */
  sendRaw(content: string, timeoutMs = 30_000): Promise<RunResult> {
    return this.runExclusive(async () => {
      const response = this.captureResponse(timeoutMs);
      try {
        await this.writer.write(Uint8Array.from([0x03, 0x03]));
        await this.writer.write(Uint8Array.from([0x01]));
        for (const line of content.split('\n')) {
          await this.writer.write(this.encoder.encode(line + '\r'));
        }
        await this.writer.write(Uint8Array.from([0x04]));
      } catch (err) {
        // A write failed — bail out the parser so it doesn't sit waiting for
        // a response that will never come. We still await `response.promise`
        // below so the rejection is observed (otherwise it surfaces as an
        // unhandled promise rejection).
        response.abort(err);
      }
      try {
        return await response.promise;
      } finally {
        // Best-effort exit raw mode. If the writer is already errored (e.g.
        // device disconnected mid-run) we don't want that to mask the real
        // failure or cause an unhandled rejection.
        try {
          await this.writer.write(Uint8Array.from([0x02]));
        } catch {
          // Writer is already closed/errored; nothing useful to do.
        }
      }
    });
  }

  /**
   * Installs a parser into `this.parser` and returns its promise plus an
   * `abort` hook for write-side failures. The parser walks the four phases
   * of the raw-REPL response (banner → OK → stdout → stderr) and resolves
   * after the second `\x04`.
   */
  private captureResponse(
    timeoutMs: number,
  ): {promise: Promise<RunResult>; abort: (reason: unknown) => void} {
    let resolveResult!: (r: RunResult) => void;
    let rejectResult!: (e: unknown) => void;
    const promise = new Promise<RunResult>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    const decoder = new TextDecoder();
    type Phase = 'banner' | 'ok' | 'stdout' | 'stderr' | 'done';
    let phase: Phase = 'banner';
    // Rolling text scratch for the banner and OK phases. Bounded to a few
    // multiples of the longest needle so a chatty device leftover from a
    // prior program can't grow the buffer without limit.
    let scratch = '';
    const stdoutBytes: number[] = [];
    const stderrBytes: number[] = [];

    const finish = () => {
      if (phase === 'done') return;
      phase = 'done';
      this.parser = null;
      clearTimeout(timer);
      resolveResult({
        stdout: decoder.decode(Uint8Array.from(stdoutBytes)),
        stderr: decoder.decode(Uint8Array.from(stderrBytes)),
      });
    };

    const fail = (reason: unknown) => {
      if (phase === 'done') return;
      phase = 'done';
      this.parser = null;
      clearTimeout(timer);
      rejectResult(reason);
    };

    const timer = setTimeout(() => {
      fail(new Error('Timed out waiting for raw REPL response'));
    }, timeoutMs);

    const SCRATCH_CAP = Math.max(RAW_BANNER.length, OK.length) * 4;

    const parser: ResponseParser = {
      feed: (chunk) => {
        for (let i = 0; i < chunk.length; i++) {
          const b = chunk[i];
          if (phase === 'banner') {
            scratch += String.fromCharCode(b);
            if (scratch.length > SCRATCH_CAP) {
              scratch = scratch.slice(-RAW_BANNER.length);
            }
            if (scratch.endsWith(RAW_BANNER)) {
              phase = 'ok';
              scratch = '';
            }
          } else if (phase === 'ok') {
            scratch += String.fromCharCode(b);
            if (scratch.endsWith(OK)) {
              phase = 'stdout';
              scratch = '';
            } else if (scratch.length > SCRATCH_CAP) {
              scratch = scratch.slice(-OK.length);
            }
          } else if (phase === 'stdout') {
            if (b === EOT) {
              phase = 'stderr';
            } else {
              stdoutBytes.push(b);
            }
          } else if (phase === 'stderr') {
            if (b === EOT) {
              finish();
              return;
            }
            stderrBytes.push(b);
          }
        }
      },
      abort: (reason) => fail(reason),
    };

    this.parser = parser;
    return {promise, abort: parser.abort};
  }

  static async connect(
        baudRate: number = 115200,
        dataBits: number = 8,
        stopBits: number = 1): Promise<ReplInterface> {
    if (!navigator.serial) {
      throw new Error('The Web Serial API is not supported');
    }
    const port = await navigator.serial!.requestPort();
    await port.open({
      baudRate: baudRate,
      dataBits: dataBits,
      stopBits: stopBits,
    });

    return new ReplInterface(port);
  }
}
