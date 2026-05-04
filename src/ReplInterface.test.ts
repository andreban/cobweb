// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReplInterface } from './ReplInterface';

/**
 * In-memory stand-in for a Web Serial port. Captures every chunk the SUT writes
 * and lets the test push bytes into the readable stream that drives the read loop.
 */
class FakeSerialPort {
  written: Uint8Array[] = [];
  closed = false;
  writableClosed = false;
  readableCancelled = false;

  /**
   * Optional hook letting tests fail a specific write. Return an Error to
   * reject the underlying sink (which errors the stream), or null/undefined
   * to accept the chunk normally.
   */
  shouldRejectWrite?: (chunk: Uint8Array, index: number) => Error | null | undefined;

  writable: WritableStream<Uint8Array>;
  readable: ReadableStream<Uint8Array>;

  private readableController!: ReadableStreamDefaultController<Uint8Array>;

  constructor() {
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        const copy = new Uint8Array(chunk);
        const err = this.shouldRejectWrite?.(copy, this.written.length);
        if (err) throw err;
        this.written.push(copy);
      },
      close: () => {
        this.writableClosed = true;
      },
    });

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.readableController = controller;
      },
      cancel: () => {
        this.readableCancelled = true;
      },
    });
  }

  inject(data: Uint8Array | number[]) {
    const chunk = data instanceof Uint8Array ? data : Uint8Array.from(data);
    this.readableController.enqueue(chunk);
  }

  endReadable() {
    try {
      this.readableController.close();
    } catch {
      // Already closed or cancelled.
    }
  }

  errorReadable(reason: unknown) {
    try {
      this.readableController.error(reason);
    } catch {
      // Already closed or errored.
    }
  }

  async close() {
    this.closed = true;
  }
}

const bytes = (...n: number[]) => Uint8Array.from(n);
const encode = (s: string) => new TextEncoder().encode(s);

const concat = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
};

describe('ReplInterface', () => {
  let port: FakeSerialPort;
  let repl: ReplInterface;

  beforeEach(() => {
    port = new FakeSerialPort();
    repl = new ReplInterface(port as unknown as SerialPort);
  });

  afterEach(() => {
    // Let the read loop terminate so it doesn't bleed into the next test.
    port.endReadable();
  });

  describe('read loop', () => {
    it('dispatches a data event with the bytes that arrived on the stream', async () => {
      const detail = await new Promise<Uint8Array>((resolve) => {
        repl.addEventListener(
          'data',
          (e) => resolve((e as CustomEvent<Uint8Array>).detail),
          { once: true },
        );
        port.inject([0x68, 0x69]); // "hi"
      });
      expect(detail).toEqual(bytes(0x68, 0x69));
    });

    it('dispatches one event per chunk in arrival order', async () => {
      const seen: Uint8Array[] = [];
      const allReceived = new Promise<void>((resolve) => {
        repl.addEventListener('data', (e) => {
          seen.push((e as CustomEvent<Uint8Array>).detail);
          if (seen.length === 2) resolve();
        });
      });
      port.inject([0x01]);
      port.inject([0x02, 0x03]);
      await allReceived;
      expect(seen).toEqual([bytes(0x01), bytes(0x02, 0x03)]);
    });
  });

  describe('disconnect event', () => {
    it('fires when the readable stream errors (e.g. cable unplug)', async () => {
      const failure = new Error('device disconnected');
      const event = await new Promise<CustomEvent<{error: unknown}>>((resolve) => {
        repl.addEventListener(
          'disconnect',
          (e) => resolve(e as CustomEvent<{error: unknown}>),
          {once: true},
        );
        port.errorReadable(failure);
      });
      expect(event.detail?.error).toBe(failure);
    });

    it('fires when the readable stream closes cleanly, with no error detail', async () => {
      const event = await new Promise<CustomEvent<{error: unknown} | null>>((resolve) => {
        repl.addEventListener(
          'disconnect',
          (e) => resolve(e as CustomEvent<{error: unknown} | null>),
          {once: true},
        );
        port.endReadable();
      });
      expect(event.detail).toBeNull();
    });

    it('does not leave an unhandled rejection when the readable stream errors', async () => {
      const failure = new Error('device disconnected');
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const seen = new Promise<void>((resolve) => {
          repl.addEventListener('disconnect', () => resolve(), {once: true});
        });
        port.errorReadable(failure);
        await seen;
        // Let queued microtasks settle so any orphaned rejection surfaces.
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  describe('send', () => {
    it('UTF-8 encodes ASCII content and writes it as a single chunk', async () => {
      await repl.send('print(1)\r');
      expect(port.written).toHaveLength(1);
      expect(port.written[0]).toEqual(encode('print(1)\r'));
    });

    it('UTF-8 encodes multi-byte characters', async () => {
      await repl.send('héllo');
      expect(concat(port.written)).toEqual(encode('héllo'));
    });
  });

  describe('disconnect', () => {
    it('closes the writer, cancels the reader, and closes the port', async () => {
      await repl.disconnect();
      expect(port.writableClosed).toBe(true);
      expect(port.readableCancelled).toBe(true);
      expect(port.closed).toBe(true);
    });
  });

  describe('reset', () => {
    // The MicroPython protocol calls for Ctrl-C, Ctrl-C (interrupt), Ctrl-A
    // (raw mode), Ctrl-D (soft reset), Ctrl-B (exit raw mode).
    // See https://docs.micropython.org/en/latest/reference/repl.html.

    it('begins with Ctrl-C twice (0x03 0x03), not XOFF', async () => {
      await repl.reset();
      expect(port.written[0]).toEqual(bytes(0x03, 0x03));
    });

    it('sends Ctrl-A then Ctrl-D then Ctrl-B', async () => {
      await repl.reset();
      expect(port.written[1]).toEqual(bytes(0x01));
      expect(port.written[2]).toEqual(bytes(0x04));
      expect(port.written[3]).toEqual(bytes(0x02));
    });

    it('writes exactly four chunks', async () => {
      await repl.reset();
      expect(port.written).toHaveLength(4);
    });
  });

  describe('sendRaw', () => {
    it('opens with Ctrl-C twice and Ctrl-A', async () => {
      await repl.sendRaw('print(1)');
      expect(port.written[0]).toEqual(bytes(0x03, 0x03));
      expect(port.written[1]).toEqual(bytes(0x01));
    });

    it('terminates with Ctrl-D then Ctrl-B', async () => {
      await repl.sendRaw('print(1)');
      const last = port.written.length - 1;
      expect(port.written[last - 1]).toEqual(bytes(0x04));
      expect(port.written[last]).toEqual(bytes(0x02));
    });

    it('writes a single-line payload as `<line>\\r`', async () => {
      await repl.sendRaw('print(1)');
      const body = port.written.slice(2, -2);
      expect(body).toEqual([encode('print(1)\r')]);
    });

    it('writes each line of a multi-line payload in order, CR-terminated, before Ctrl-D', async () => {
      await repl.sendRaw('a\nb\nc');
      const body = port.written.slice(2, -2);
      expect(body).toEqual([encode('a\r'), encode('b\r'), encode('c\r')]);
      // And the body sits between the prologue and the Ctrl-D / Ctrl-B epilogue.
      expect(port.written[port.written.length - 2]).toEqual(bytes(0x04));
    });

    it('sends a single CR for empty content', async () => {
      await repl.sendRaw('');
      const body = port.written.slice(2, -2);
      expect(body).toEqual([encode('\r')]);
    });

    it('rejects when a line write fails mid-payload, with no unhandled rejections', async () => {
      const failure = new Error('device disconnected');
      const target = encode('b\r');
      port.shouldRejectWrite = (chunk) => {
        if (chunk.length === target.length && chunk.every((b, i) => b === target[i])) {
          return failure;
        }
        return null;
      };

      // The original forEach-based implementation discarded each line write's
      // promise, so a mid-payload failure surfaced as an unhandled rejection
      // even though sendRaw still rejected (via the errored-stream epilogue).
      // Verify both: sendRaw rejects with the original failure AND no rejection
      // is left dangling.
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        await expect(repl.sendRaw('a\nb\nc')).rejects.toBe(failure);
        // Let queued microtasks settle so any orphaned rejection surfaces.
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  describe('connect', () => {
    it('throws when the Web Serial API is unavailable', async () => {
      // happy-dom does not implement Web Serial, so navigator.serial is undefined.
      const nav = navigator as unknown as { serial?: unknown };
      const original = nav.serial;
      delete nav.serial;
      try {
        await expect(ReplInterface.connect()).rejects.toThrow(/Web Serial/);
      } finally {
        if (original !== undefined) {
          Object.defineProperty(navigator, 'serial', {
            value: original,
            configurable: true,
          });
        }
      }
    });
  });
});
