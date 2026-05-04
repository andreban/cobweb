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

  /**
   * Optional hook fired after each successful write. Tests use it to inject
   * device responses synchronously in lockstep with the SUT's protocol writes
   * (e.g. emit the raw banner the moment the SUT sends Ctrl-A).
   */
  onWrite?: (chunk: Uint8Array, index: number) => void;

  writable: WritableStream<Uint8Array>;
  readable: ReadableStream<Uint8Array>;

  private readableController!: ReadableStreamDefaultController<Uint8Array>;

  constructor() {
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        const copy = new Uint8Array(chunk);
        const err = this.shouldRejectWrite?.(copy, this.written.length);
        if (err) throw err;
        const index = this.written.length;
        this.written.push(copy);
        this.onWrite?.(copy, index);
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

/**
 * A minimal canned raw-REPL response: banner, OK, the supplied stdout/stderr,
 * the two `\x04` framing bytes, and the trailing `>`.
 */
const okResponse = (stdout = '', stderr = ''): Uint8Array =>
  concat([
    encode('\r\nraw REPL; CTRL-B to exit\r\n>OK'),
    encode(stdout),
    bytes(0x04),
    encode(stderr),
    bytes(0x04),
    encode('>'),
  ]);

/**
 * Auto-respond to any `sendRaw` issued during the test: when the SUT writes
 * Ctrl-D (the last protocol write before it begins waiting), inject the
 * canned response. Returns an unsubscribe so tests that need finer control
 * can disable the auto-reply.
 */
const autoRespond = (port: FakeSerialPort, response: Uint8Array = okResponse()): (() => void) => {
  const previous = port.onWrite;
  port.onWrite = (chunk, index) => {
    previous?.(chunk, index);
    if (chunk.length === 1 && chunk[0] === 0x04) {
      port.inject(response);
    }
  };
  return () => {
    port.onWrite = previous;
  };
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

    it('does not deadlock when called while a sendRaw is in flight', async () => {
      // disconnect must not wait on the write-serialization chain — if it did,
      // a stalled write would prevent the writer from ever closing. We start
      // a sendRaw (no auto-response, so the parser is hanging) and immediately
      // disconnect; both promises must settle.
      const sendPromise = repl.sendRaw('print(1)').catch(() => undefined);
      const disconnectPromise = repl.disconnect();
      await Promise.race([
        Promise.all([sendPromise, disconnectPromise]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('disconnect deadlocked')), 1000),
        ),
      ]);
      expect(port.writableClosed).toBe(true);
    });

    it('rejects an in-flight sendRaw when the read loop ends', async () => {
      const failure = new Error('device disconnected');
      const sendPromise = repl.sendRaw('print(1)');
      // Bytes start arriving but the response never completes (no \x04 pair).
      port.errorReadable(failure);
      await expect(sendPromise).rejects.toBe(failure);
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

  describe('sendRaw — protocol writes', () => {
    it('opens with Ctrl-C twice and Ctrl-A', async () => {
      autoRespond(port);
      await repl.sendRaw('print(1)');
      expect(port.written[0]).toEqual(bytes(0x03, 0x03));
      expect(port.written[1]).toEqual(bytes(0x01));
    });

    it('terminates with Ctrl-D then Ctrl-B', async () => {
      autoRespond(port);
      await repl.sendRaw('print(1)');
      const last = port.written.length - 1;
      expect(port.written[last - 1]).toEqual(bytes(0x04));
      expect(port.written[last]).toEqual(bytes(0x02));
    });

    it('writes a single-line payload as `<line>\\r`', async () => {
      autoRespond(port);
      await repl.sendRaw('print(1)');
      const body = port.written.slice(2, -2);
      expect(body).toEqual([encode('print(1)\r')]);
    });

    it('writes each line of a multi-line payload in order, CR-terminated, before Ctrl-D', async () => {
      autoRespond(port);
      await repl.sendRaw('a\nb\nc');
      const body = port.written.slice(2, -2);
      expect(body).toEqual([encode('a\r'), encode('b\r'), encode('c\r')]);
      expect(port.written[port.written.length - 2]).toEqual(bytes(0x04));
    });

    it('sends a single CR for empty content', async () => {
      autoRespond(port);
      await repl.sendRaw('');
      const body = port.written.slice(2, -2);
      expect(body).toEqual([encode('\r')]);
    });

    it('only writes the trailing Ctrl-B after the device finishes responding', async () => {
      // Hook the writes: when the SUT issues Ctrl-D, snapshot what's been
      // written so far, then inject the response. By the time `sendRaw`
      // resolves we expect exactly one extra write — the Ctrl-B epilogue.
      let snapshot: Uint8Array[] | null = null;
      port.onWrite = (chunk) => {
        if (chunk.length === 1 && chunk[0] === 0x04) {
          snapshot = port.written.slice();
          port.inject(okResponse('', ''));
        }
      };
      await repl.sendRaw('print(1)');
      expect(snapshot).not.toBeNull();
      // Snapshot taken at Ctrl-D: prologue + body + Ctrl-D = 4 chunks.
      expect(snapshot!).toHaveLength(4);
      // After resolution, Ctrl-B has been appended.
      expect(port.written).toHaveLength(5);
      expect(port.written[4]).toEqual(bytes(0x02));
    });

    it('serializes concurrent calls so each prologue/body/epilogue runs contiguously', async () => {
      autoRespond(port);
      await Promise.all([repl.sendRaw('a'), repl.sendRaw('b')]);

      // Each sendRaw produces 5 chunks: Ctrl-CC, Ctrl-A, body, Ctrl-D, Ctrl-B.
      expect(port.written).toHaveLength(10);

      expect(port.written.slice(0, 5)).toEqual([
        bytes(0x03, 0x03),
        bytes(0x01),
        encode('a\r'),
        bytes(0x04),
        bytes(0x02),
      ]);
      expect(port.written.slice(5, 10)).toEqual([
        bytes(0x03, 0x03),
        bytes(0x01),
        encode('b\r'),
        bytes(0x04),
        bytes(0x02),
      ]);
    });

    it('still serializes the next call after the previous one rejects mid-payload', async () => {
      autoRespond(port);
      const failure = new Error('device hiccup');
      const target = encode('a\r');
      port.shouldRejectWrite = (chunk) => {
        if (chunk.length === target.length && chunk.every((b, i) => b === target[i])) {
          port.shouldRejectWrite = undefined;
          return failure;
        }
        return null;
      };

      const failed = repl.sendRaw('a');
      const next = repl.sendRaw('b');
      await expect(failed).rejects.toBe(failure);
      // `next` must still run — a failed task shouldn't poison the chain. But
      // the writable stream itself errors on the rejected write, so this call
      // rejects too; what matters is that it actually attempts to run.
      await expect(next).rejects.toBeDefined();
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

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        await expect(repl.sendRaw('a\nb\nc')).rejects.toBe(failure);
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  describe('sendRaw — response parser', () => {
    it('returns stdout from the captured response, with empty stderr on success', async () => {
      port.onWrite = (chunk) => {
        if (chunk.length === 1 && chunk[0] === 0x04) {
          port.inject(okResponse('1\r\n', ''));
        }
      };
      const result = await repl.sendRaw('print(1)');
      expect(result).toEqual({stdout: '1\r\n', stderr: ''});
    });

    it('captures stderr for a runtime exception, with stdout empty', async () => {
      const traceback =
        'Traceback (most recent call last):\r\n' +
        '  File "<stdin>", line 1, in <module>\r\n' +
        'NameError: name \'undefined\' is not defined\r\n';
      port.onWrite = (chunk) => {
        if (chunk.length === 1 && chunk[0] === 0x04) {
          port.inject(okResponse('', traceback));
        }
      };
      const result = await repl.sendRaw('undefined');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(traceback);
    });

    it('captures both stdout and stderr when the program prints before failing', async () => {
      const traceback = 'Traceback (most recent call last):\r\nZeroDivisionError\r\n';
      port.onWrite = (chunk) => {
        if (chunk.length === 1 && chunk[0] === 0x04) {
          port.inject(okResponse('partial\r\n', traceback));
        }
      };
      const result = await repl.sendRaw('print("partial"); 1/0');
      expect(result.stdout).toBe('partial\r\n');
      expect(result.stderr).toBe(traceback);
    });

    it('captures syntax-error tracebacks as stderr', async () => {
      const traceback = 'Traceback (most recent call last):\r\nSyntaxError: invalid syntax\r\n';
      port.onWrite = (chunk) => {
        if (chunk.length === 1 && chunk[0] === 0x04) {
          port.inject(okResponse('', traceback));
        }
      };
      const result = await repl.sendRaw(')');
      expect(result.stderr).toBe(traceback);
    });

    it('still dispatches a `data` event with the device bytes for the xterm mirror', async () => {
      const seen: Uint8Array[] = [];
      repl.addEventListener('data', (e) => {
        seen.push((e as CustomEvent<Uint8Array>).detail);
      });
      const response = okResponse('hi\r\n', '');
      port.onWrite = (chunk) => {
        if (chunk.length === 1 && chunk[0] === 0x04) {
          port.inject(response);
        }
      };
      await repl.sendRaw('print("hi")');
      // Every byte the device emitted should also be visible to the data listener.
      expect(concat(seen)).toEqual(response);
    });

    it('parses a response delivered byte-by-byte', async () => {
      const response = okResponse('ok\r\n', '');
      port.onWrite = (chunk) => {
        if (chunk.length === 1 && chunk[0] === 0x04) {
          for (const b of response) port.inject([b]);
        }
      };
      const result = await repl.sendRaw('print("ok")');
      expect(result).toEqual({stdout: 'ok\r\n', stderr: ''});
    });

    it('ignores leftover bytes from a previous program before the banner', async () => {
      const leftover = encode('garbage from the previous run\r\n');
      port.onWrite = (chunk) => {
        if (chunk.length === 1 && chunk[0] === 0x04) {
          port.inject(concat([leftover, okResponse('done\r\n', '')]));
        }
      };
      const result = await repl.sendRaw('print("done")');
      expect(result).toEqual({stdout: 'done\r\n', stderr: ''});
    });

    it('rejects when the timeout elapses before the response completes', async () => {
      // No auto-respond: the parser will sit in the banner phase forever.
      await expect(repl.sendRaw('print(1)', 20)).rejects.toThrow(/timed out/i);
    });

    it('still tries to send Ctrl-B after a timeout so the device leaves raw mode', async () => {
      await expect(repl.sendRaw('print(1)', 20)).rejects.toThrow(/timed out/i);
      // After timeout: prologue (Ctrl-CC, Ctrl-A) + body + Ctrl-D + Ctrl-B = 5 chunks.
      expect(port.written[port.written.length - 1]).toEqual(bytes(0x02));
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
