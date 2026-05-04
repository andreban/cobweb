// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

const RAW_BANNER = 'raw REPL; CTRL-B to exit\r\n>';
const OK = 'OK';
const EOT = 0x04;
const PASTE_REQUEST = Uint8Array.from([0x05, 0x41, 0x01]); // Ctrl-E, 'A', Ctrl-A

export interface RunResult {
  stdout: string;
  stderr: string;
}

type HandshakeResult =
  | {mode: 'plain'}
  | {mode: 'paste'; windowIncrement: number; initialRemaining: number};

type FlowControl = 'window' | 'abort';

interface ResponseExchange {
  feed(chunk: Uint8Array): void;
  abort(reason: unknown): void;
  awaitBanner(): Promise<void>;
  awaitHandshake(): Promise<HandshakeResult>;
  awaitFlowControl(): Promise<FlowControl>;
  endOfData(): void;
  awaitResult(): Promise<RunResult>;
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
  // Active raw-REPL response exchange. The read loop hands every incoming
  // chunk to it (in addition to dispatching the `'data'` event). At most one
  // is active because `sendRaw` runs under the write-serialization mutex.
  private exchange: ResponseExchange | null = null;

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
          this.exchange?.feed(value);
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
    this.exchange?.abort(error ?? new Error('disconnected'));
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
   * and stderr. The protocol (per the MicroPython docs) is:
   *
   *   1. Ctrl-A → device emits `\r\nraw REPL; CTRL-B to exit\r\n>`.
   *   2. `\x05A\x01` (raw-paste request) → device responds:
   *        - `R\x00`: not supported, fall back to plain raw mode.
   *        - `R\x01<lo><hi>`: supported; the next two bytes are the window
   *          size increment (LE u16). Stream code respecting the window;
   *          honour `\x01` (window+) and `\x04` (abort) flow-control bytes.
   *   3. Send `\x04` end-of-data; device responds with `\x04` (raw-paste
   *      ack) or `OK` (plain mode), then stdout, `\x04`, stderr, `\x04`, `>`.
   *
   * Bytes are still dispatched via the `'data'` event so xterm mirrors the
   * full conversation; the parser only inspects them.
   *
   * Rejects if `timeoutMs` elapses before the response completes, or if
   * the connection drops mid-flight. The `Ctrl-B` epilogue is sent
   * best-effort either way so the device leaves raw mode.
   */
  sendRaw(content: string, timeoutMs = 30_000): Promise<RunResult> {
    return this.runExclusive(async () => {
      const exchange = this.captureResponse(timeoutMs);
      try {
        await this.writer.write(Uint8Array.from([0x03, 0x03]));
        await this.writer.write(Uint8Array.from([0x01]));
        await exchange.awaitBanner();

        await this.writer.write(PASTE_REQUEST);
        const handshake = await exchange.awaitHandshake();

        if (handshake.mode === 'paste') {
          await this.streamPaste(content, handshake, exchange);
        } else {
          for (const line of content.split('\n')) {
            await this.writer.write(this.encoder.encode(line + '\r'));
          }
          await this.writer.write(Uint8Array.from([EOT]));
        }
      } catch (err) {
        // A write failed — bail out the exchange so it doesn't sit waiting
        // for a response that will never come. We still await the result
        // below so the rejection is observed (otherwise it surfaces as an
        // unhandled promise rejection).
        exchange.abort(err);
      }
      try {
        return await exchange.awaitResult();
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
   * Streams `content` to the device under raw-paste flow control. Each chunk
   * is at most `windowRemaining` bytes; when the window hits zero we wait
   * for the device to either send `\x01` (refill) or `\x04` (abort). On
   * abort we stop immediately but still send end-of-data so the device
   * leaves paste mode cleanly — its stderr will carry the failure reason.
   */
  private async streamPaste(
    content: string,
    handshake: {mode: 'paste'; windowIncrement: number; initialRemaining: number},
    exchange: ResponseExchange,
  ): Promise<void> {
    const bytes = this.encoder.encode(content);
    let offset = 0;
    let windowRemaining = handshake.initialRemaining;

    while (offset < bytes.length) {
      if (windowRemaining === 0) {
        const fc = await exchange.awaitFlowControl();
        if (fc === 'abort') {
          // Stop sending immediately. We still send end-of-data below so
          // the device leaves paste mode cleanly; its stderr will carry
          // the abort reason (e.g. a MemoryError).
          break;
        }
        windowRemaining += handshake.windowIncrement;
        continue;
      }
      const chunkSize = Math.min(windowRemaining, bytes.length - offset);
      // slice (copy) instead of subarray so the WritableStream sink owns
      // an independent buffer.
      const chunk = bytes.slice(offset, offset + chunkSize);
      await this.writer.write(chunk);
      offset += chunkSize;
      windowRemaining -= chunkSize;
    }

    // Tell the parser the next \x04 is the end-of-data ack, not a flow-
    // control abort. Ordering matters: we set this *before* the write so
    // a fast device can't race ahead of us.
    exchange.endOfData();
    await this.writer.write(Uint8Array.from([EOT]));
  }

  /**
   * Installs a parser into `this.exchange` and returns its promises plus an
   * `abort` hook for write-side failures. The parser walks the raw-REPL
   * response phases (banner → handshake → [paste streaming | plain OK] →
   * stdout → `\x04` → stderr → `\x04`) and resolves after the second `\x04`.
   */
  private captureResponse(timeoutMs: number): ResponseExchange {
    type Phase =
      | 'banner'
      | 'r-byte'
      | 'r-status'
      | 'paste-window-lo'
      | 'paste-window-hi'
      | 'paste-streaming'
      | 'plain-ok'
      | 'stdout'
      | 'stderr'
      | 'done';

    let phase: Phase = 'banner';
    // Rolling text scratch for the banner and OK phases. Bounded to a few
    // multiples of the longest needle so a chatty device leftover from a
    // prior program can't grow the buffer without limit.
    let scratch = '';
    let pasteWindowLo = 0;
    let windowIncrement = 0;
    // Once the SUT has written end-of-data Ctrl-D, the next `\x04` from the
    // device is the raw-paste ack — not a flow-control abort. We toggle this
    // flag in `endOfData()` so the parser disambiguates the two.
    let expectingPasteAck = false;
    const stdoutBytes: number[] = [];
    const stderrBytes: number[] = [];

    let resolveBanner!: () => void;
    let rejectBanner!: (e: unknown) => void;
    const bannerPromise = new Promise<void>((res, rej) => {
      resolveBanner = res;
      rejectBanner = rej;
    });
    bannerPromise.catch(() => {/* observed if anyone awaits it */});

    let resolveHandshake!: (h: HandshakeResult) => void;
    let rejectHandshake!: (e: unknown) => void;
    const handshakePromise = new Promise<HandshakeResult>((res, rej) => {
      resolveHandshake = res;
      rejectHandshake = rej;
    });
    handshakePromise.catch(() => {});

    let resolveResult!: (r: RunResult) => void;
    let rejectResult!: (e: unknown) => void;
    const resultPromise = new Promise<RunResult>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    const flowControlQueue: FlowControl[] = [];
    const flowControlWaiters: Array<{
      resolve: (v: FlowControl) => void;
      reject: (e: unknown) => void;
    }> = [];

    const decoder = new TextDecoder();
    const SCRATCH_CAP = Math.max(RAW_BANNER.length, OK.length) * 4;

    const cleanup = () => {
      phase = 'done';
      this.exchange = null;
      clearTimeout(timer);
    };

    const fail = (reason: unknown) => {
      if (phase === 'done') return;
      cleanup();
      rejectBanner(reason);
      rejectHandshake(reason);
      rejectResult(reason);
      for (const w of flowControlWaiters) w.reject(reason);
      flowControlWaiters.length = 0;
    };

    const finish = () => {
      if (phase === 'done') return;
      cleanup();
      resolveResult({
        stdout: decoder.decode(Uint8Array.from(stdoutBytes)),
        stderr: decoder.decode(Uint8Array.from(stderrBytes)),
      });
    };

    const timer = setTimeout(() => {
      fail(new Error('Timed out waiting for raw REPL response'));
    }, timeoutMs);

    const pushFlowControl = (v: FlowControl) => {
      const w = flowControlWaiters.shift();
      if (w) w.resolve(v);
      else flowControlQueue.push(v);
    };

    const exchange: ResponseExchange = {
      feed: (chunk) => {
        for (let i = 0; i < chunk.length; i++) {
          const b = chunk[i];
          if (phase === 'banner') {
            scratch += String.fromCharCode(b);
            if (scratch.length > SCRATCH_CAP) {
              scratch = scratch.slice(-RAW_BANNER.length);
            }
            if (scratch.endsWith(RAW_BANNER)) {
              phase = 'r-byte';
              scratch = '';
              resolveBanner();
            }
          } else if (phase === 'r-byte') {
            if (b === 0x52) { // 'R'
              phase = 'r-status';
            } else {
              fail(
                new Error(
                  `Unexpected byte 0x${b.toString(16).padStart(2, '0')} ` +
                    `(expected 'R' for raw-paste handshake)`,
                ),
              );
              return;
            }
          } else if (phase === 'r-status') {
            if (b === 0x00) {
              phase = 'plain-ok';
              resolveHandshake({mode: 'plain'});
            } else if (b === 0x01) {
              phase = 'paste-window-lo';
            } else {
              fail(
                new Error(
                  `Unexpected raw-paste status 0x${b.toString(16).padStart(2, '0')}`,
                ),
              );
              return;
            }
          } else if (phase === 'paste-window-lo') {
            pasteWindowLo = b;
            phase = 'paste-window-hi';
          } else if (phase === 'paste-window-hi') {
            windowIncrement = pasteWindowLo | (b << 8);
            phase = 'paste-streaming';
            resolveHandshake({
              mode: 'paste',
              windowIncrement,
              initialRemaining: windowIncrement,
            });
          } else if (phase === 'paste-streaming') {
            if (expectingPasteAck) {
              if (b === EOT) {
                phase = 'stdout';
                expectingPasteAck = false;
              }
              // Any stray flow-control \x01 that arrived after we set
              // end-of-data is harmless — discard it.
            } else {
              if (b === 0x01) {
                pushFlowControl('window');
              } else if (b === EOT) {
                pushFlowControl('abort');
              }
              // Other bytes are not part of the paste protocol; ignore.
            }
          } else if (phase === 'plain-ok') {
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
      awaitBanner: () => bannerPromise,
      awaitHandshake: () => handshakePromise,
      awaitFlowControl: () => {
        if (flowControlQueue.length > 0) {
          return Promise.resolve(flowControlQueue.shift()!);
        }
        return new Promise((resolve, reject) => {
          flowControlWaiters.push({resolve, reject});
        });
      },
      endOfData: () => {
        // Only meaningful while we're streaming. Late callers are no-ops.
        if (phase === 'paste-streaming') {
          expectingPasteAck = true;
          // Resolve any waiters with 'abort' so the streaming loop can
          // exit cleanly if the SUT had been blocked on flow control. In
          // practice this list is empty when endOfData runs (the SUT only
          // calls it after the streaming loop returns).
          for (const w of flowControlWaiters) w.resolve('abort');
          flowControlWaiters.length = 0;
        }
      },
      awaitResult: () => resultPromise,
    };

    this.exchange = exchange;
    return exchange;
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
