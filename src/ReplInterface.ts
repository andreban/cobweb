/*
 * Copyright 2021 Google Inc. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

export class ReplInterface extends EventTarget {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

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
        const decoded = this.decoder.decode(value);
        console.log('<<<: ', decoded);
        this.dispatchEvent(
          new CustomEvent('data', {detail: decoded}));
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
    await this.writer.write(Uint8Array.from([0x13, 0x03, 0x03]));
    
    // Ctrl-A: enter raw REPL
    await this.writer.write(Uint8Array.from([0x13, 0x01]));
    
    //  ctrl-D: soft reset
    await this.writer.write(Uint8Array.from([0x04]));

    // ctrl+B: exit raw REPL
    await this.writer.write(Uint8Array.from([0x02]));    
  }

  async send(content: string) {
    console.log('>>>: ', content);
    await this.writer.write(this.encoder.encode(content + '\r\n'));      
  }

  async sendRaw(content: string) {
    console.log('>>>(raw): ', content);
    await this.writer.write(Uint8Array.from([0x13, 0x03, 0x03]));
    await this.writer.write(Uint8Array.from([0x13, 0x01]));
    content.split('\n').forEach(
        async line => await this.writer.write(this.encoder.encode(line + '\r'))
    );
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
