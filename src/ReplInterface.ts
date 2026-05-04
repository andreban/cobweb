// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

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

  sendRaw(content: string) {
    return this.runExclusive(async () => {
      await this.writer.write(Uint8Array.from([0x03, 0x03]));
      await this.writer.write(Uint8Array.from([0x01]));
      for (const line of content.split('\n')) {
        await this.writer.write(this.encoder.encode(line + '\r'));
      }
      await this.writer.write(Uint8Array.from([0x04]));
      await this.writer.write(Uint8Array.from([0x02]));
    });
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