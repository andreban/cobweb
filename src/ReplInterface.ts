// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export type ReplMode = 'normal' | 'paste' | 'raw' | 'raw-paste';

/**
 * An implementation of the MicroPython REPL interface. Documentation for the interface itself
 * is available at https://docs.micropython.org/en/latest/reference/repl.html.
 */
export class ReplInterface extends EventTarget {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private mode: ReplMode = 'normal';

  constructor(private port: SerialPort) {
    super();
    this.writer = port.writable.getWriter()
    this.reader = port.readable.getReader();
    this.readLoop();
  }

  private async readLoop() {
    while (true) {
      const {value, done} = await this.reader.read();
      if (value) {
        this.dispatchEvent(new CustomEvent('data', {detail: value}));
      }
      if (done) {
        this.reader.releaseLock();
        break;
      }
    }
  }

  async disconnect() {
    await this.writer.close();
    await this.reader.cancel();
    await this.port.close();
  }

  async reset() {
    console.log('>>><RESET>')
    // ctrl-C twice: interrupt any running program
    await this.writer.write(Uint8Array.from([0x03, 0x03]));

    // Ctrl-A: enter raw REPL
    await this.writer.write(Uint8Array.from([0x01]));
    
    //  ctrl-D: soft reset
    await this.writer.write(Uint8Array.from([0x04]));

    // ctrl+B: exit raw REPL
    await this.writer.write(Uint8Array.from([0x02]));    
  }

  async send(content: string) {
    console.log('>>>: ', content);
    await this.writer.write(this.encoder.encode(content));      
  }

  async sendRaw(content: string) {
    console.log('>>>(raw): ', content);
    await this.writer.write(Uint8Array.from([0x03, 0x03]));
    await this.writer.write(Uint8Array.from([0x01]));
    for (const line of content.split('\n')) {
      await this.writer.write(this.encoder.encode(line + '\r'));
    }
    await this.writer.write(Uint8Array.from([0x04]));
    await this.writer.write(Uint8Array.from([0x02]));    
  }

  static async connect(
        boundRate: number = 115200,
        dataBits: number = 8,
        stopBits: number = 1): Promise<ReplInterface> {
    if (!navigator.serial) {
      throw new Error('The Web Serial API is not supported');
    }
    const port = await navigator.serial!.requestPort();
    await port.open({
      baudRate: boundRate,
      dataBits: dataBits,
      stopBits: stopBits,
    });

    return new ReplInterface(port);
  }
}