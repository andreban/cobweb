// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReplDisconnectedError, ReplInterface } from './ReplInterface';

/**
 * In-memory stand-in for a Web Serial port. Captures every chunk the SUT writes
 * and lets the test push bytes into the readable stream that drives the read loop.
 */
class FakeSerialPort {
  written: Uint8Array[] = [];
  closed = false;
  writableClosed = false;
  readableCancelled = false;
  opened = false;
  openOptions: SerialOptions | null = null;
  info: SerialPortInfo = {usbVendorId: 0x2e8a, usbProductId: 0x0005};

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

  async open(options: SerialOptions) {
    this.opened = true;
    this.openOptions = options;
  }

  getInfo(): SerialPortInfo {
    return this.info;
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

const BANNER = encode('\r\nraw REPL; CTRL-B to exit\r\n>');
const isCtrlA = (chunk: Uint8Array) => chunk.length === 1 && chunk[0] === 0x01;
const isCtrlD = (chunk: Uint8Array) => chunk.length === 1 && chunk[0] === 0x04;
const isPasteRequest = (chunk: Uint8Array) =>
  chunk.length === 3 && chunk[0] === 0x05 && chunk[1] === 0x41 && chunk[2] === 0x01;

/**
 * Drives the FakeSerialPort to behave like a device that does NOT support
 * raw-paste mode: emits the banner after Ctrl-A, replies `R\x00` to the
 * paste-request, then `OK` + stdout + `\x04` + stderr + `\x04` + `>` after
 * the SUT's end-of-data Ctrl-D.
 */
const respondPlain = (
  port: FakeSerialPort,
  options: {stdout?: string; stderr?: string} = {},
): (() => void) => {
  const stdout = options.stdout ?? '';
  const stderr = options.stderr ?? '';
  const previous = port.onWrite;
  port.onWrite = (chunk, index) => {
    previous?.(chunk, index);
    if (isCtrlA(chunk)) {
      port.inject(BANNER);
    } else if (isPasteRequest(chunk)) {
      port.inject(bytes(0x52, 0x00));
    } else if (isCtrlD(chunk)) {
      port.inject(
        concat([
          encode('OK'),
          encode(stdout),
          bytes(0x04),
          encode(stderr),
          bytes(0x04),
          encode('>'),
        ]),
      );
    }
  };
  return () => {
    port.onWrite = previous;
  };
};

/**
 * Drives the FakeSerialPort to behave like a device that DOES support
 * raw-paste mode: emits the banner after Ctrl-A, replies `R\x01` + window
 * (LE u16) to the paste-request, sends `\x01` once for every `windowSize`
 * bytes streamed in, and finally `\x04` (paste ack) + stdout + `\x04` +
 * stderr + `\x04` + `>` after the SUT's end-of-data Ctrl-D.
 */
const respondPaste = (
  port: FakeSerialPort,
  options: {windowSize?: number; stdout?: string; stderr?: string} = {},
): (() => void) => {
  const windowSize = options.windowSize ?? 128;
  const stdout = options.stdout ?? '';
  const stderr = options.stderr ?? '';

  let inStreaming = false;
  let bytesConsumed = 0;

  const previous = port.onWrite;
  port.onWrite = (chunk, index) => {
    previous?.(chunk, index);
    if (isCtrlA(chunk)) {
      port.inject(BANNER);
    } else if (isPasteRequest(chunk)) {
      port.inject(bytes(0x52, 0x01, windowSize & 0xff, (windowSize >> 8) & 0xff));
      inStreaming = true;
    } else if (inStreaming && isCtrlD(chunk)) {
      // Single-byte 0x04 chunk after handshake is the SUT's end-of-data.
      // (Source code that legitimately contains 0x04 would arrive in a
      // multi-byte data chunk, which the branch below handles.)
      inStreaming = false;
      port.inject(
        concat([
          bytes(0x04),
          encode(stdout),
          bytes(0x04),
          encode(stderr),
          bytes(0x04),
          encode('>'),
        ]),
      );
    } else if (inStreaming) {
      bytesConsumed += chunk.length;
      while (bytesConsumed >= windowSize) {
        port.inject(bytes(0x01));
        bytesConsumed -= windowSize;
      }
    }
  };
  return () => {
    port.onWrite = previous;
    inStreaming = false;
    bytesConsumed = 0;
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

    it('rejects an in-flight sendRaw with ReplDisconnectedError when the read loop ends', async () => {
      const failure = new Error('device disconnected');
      const sendPromise = repl.sendRaw('print(1)');
      // Bytes start arriving but the response never completes (no \x04 pair).
      port.errorReadable(failure);
      const err = await sendPromise.catch((e) => e);
      expect(err).toBeInstanceOf(ReplDisconnectedError);
      expect((err as Error).cause).toBe(failure);
    });
  });

  describe('after device-lost', () => {
    // Once the read loop ends, every public write method must reject with a
    // typed ReplDisconnectedError instead of letting a raw stream error
    // (UnknownError, NetworkError, TypeError on closed stream, …) escape.
    const waitForDisconnect = (r: ReplInterface) =>
      new Promise<void>((resolve) => {
        r.addEventListener('disconnect', () => resolve(), {once: true});
      });

    it('reset() rejects with ReplDisconnectedError after the read loop ends', async () => {
      const seen = waitForDisconnect(repl);
      port.errorReadable(new Error('cable yanked'));
      await seen;
      await expect(repl.reset()).rejects.toBeInstanceOf(ReplDisconnectedError);
    });

    it('send() rejects with ReplDisconnectedError after the read loop ends', async () => {
      const seen = waitForDisconnect(repl);
      port.errorReadable(new Error('cable yanked'));
      await seen;
      await expect(repl.send('x')).rejects.toBeInstanceOf(ReplDisconnectedError);
    });

    it('sendRaw() rejects with ReplDisconnectedError after the read loop ends', async () => {
      const seen = waitForDisconnect(repl);
      port.errorReadable(new Error('cable yanked'));
      await seen;
      await expect(repl.sendRaw('x')).rejects.toBeInstanceOf(ReplDisconnectedError);
    });

    it('disconnect() resolves cleanly when the writable stream has errored', async () => {
      // First, error the writer by failing a write. After this every
      // subsequent operation on the writer (including close()) rejects.
      port.shouldRejectWrite = () => new Error('device gone');
      await expect(repl.send('x')).rejects.toBeInstanceOf(ReplDisconnectedError);
      // disconnect() must still resolve — it has to tolerate an errored
      // writer instead of letting a `Cannot close a ERRORED writable stream`
      // TypeError escape.
      await expect(repl.disconnect()).resolves.toBeUndefined();
    });

    it('reset() preserves the underlying write failure as `cause`', async () => {
      const failure = new Error('cable yanked');
      port.shouldRejectWrite = () => failure;
      const err = await repl.reset().catch((e) => e);
      expect(err).toBeInstanceOf(ReplDisconnectedError);
      expect((err as Error).cause).toBe(failure);
    });

    it('does not leak unhandled rejections from any write method', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const seen = waitForDisconnect(repl);
        port.errorReadable(new Error('cable yanked'));
        await seen;
        await Promise.all([
          repl.reset().catch(() => undefined),
          repl.send('x').catch(() => undefined),
          repl.sendRaw('y').catch(() => undefined),
          repl.disconnect().catch(() => undefined),
        ]);
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
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

  describe('sendRaw — handshake', () => {
    it('opens with Ctrl-C twice, Ctrl-A, then the raw-paste request \\x05A\\x01', async () => {
      respondPlain(port);
      await repl.sendRaw('print(1)');
      expect(port.written[0]).toEqual(bytes(0x03, 0x03));
      expect(port.written[1]).toEqual(bytes(0x01));
      expect(port.written[2]).toEqual(bytes(0x05, 0x41, 0x01));
    });

    it('does not send the paste request until the banner has arrived', async () => {
      // Inject the banner in two pieces, separated by a microtask, then
      // assert the SUT held off on the paste request until both pieces
      // arrived. We never finish the rest of the protocol — the test
      // tears down via timeout.
      let pasteRequestIndex = -1;
      port.onWrite = (chunk, index) => {
        if (isCtrlA(chunk)) {
          // First half of the banner only; SUT must still be waiting.
          port.inject(BANNER.slice(0, 8));
        }
        if (isPasteRequest(chunk)) {
          pasteRequestIndex = index;
        }
      };
      const send = repl.sendRaw('x', 50).catch(() => undefined);
      // Let the SUT consume the partial banner.
      await new Promise((r) => setTimeout(r, 5));
      expect(pasteRequestIndex).toBe(-1);
      // Now finish the banner.
      port.inject(BANNER.slice(8));
      await new Promise((r) => setTimeout(r, 5));
      expect(pasteRequestIndex).toBeGreaterThan(0);
      await send;
    });

    it('falls back to plain raw mode when the device replies R\\x00', async () => {
      respondPlain(port);
      await repl.sendRaw('print(1)');
      // After the paste request (chunks[2]) we expect <line>\\r writes —
      // the plain-mode path. In paste mode there would be no \\r insertion.
      const body = port.written.slice(3, -2);
      expect(body).toEqual([encode('print(1)\r')]);
    });

    it('uses raw-paste mode when the device replies R\\x01 with a window', async () => {
      respondPaste(port, {windowSize: 128});
      await repl.sendRaw('print(1)');
      // Paste mode writes the source bytes verbatim, no \\r insertion.
      const body = port.written.slice(3, -2);
      expect(body).toEqual([encode('print(1)')]);
    });

    it('reads the window size as a little-endian u16', async () => {
      // windowSize = 0x0140 = 320; lo=0x40, hi=0x01.
      // Force at least one window refill by sending more than 320 bytes.
      const content = 'x'.repeat(500);
      respondPaste(port, {windowSize: 320});
      await repl.sendRaw(content);
      const body = port.written.slice(3, -2);
      // First chunk should be exactly 320 bytes (the initial window).
      expect(body[0]).toHaveLength(320);
      // Total bytes streamed must equal content length.
      const totalBytes = body.reduce((n, c) => n + c.length, 0);
      expect(totalBytes).toBe(500);
    });

    it('rejects when the handshake response is malformed', async () => {
      port.onWrite = (chunk) => {
        if (isCtrlA(chunk)) {
          port.inject(BANNER);
        } else if (isPasteRequest(chunk)) {
          // Garbage where 'R' was expected.
          port.inject(bytes(0x58, 0x00));
        }
      };
      await expect(repl.sendRaw('x')).rejects.toThrow(/raw-paste handshake/);
    });
  });

  describe('sendRaw — protocol writes', () => {
    it('terminates with Ctrl-D then Ctrl-B', async () => {
      respondPlain(port);
      await repl.sendRaw('print(1)');
      const last = port.written.length - 1;
      expect(port.written[last - 1]).toEqual(bytes(0x04));
      expect(port.written[last]).toEqual(bytes(0x02));
    });

    it('plain raw fallback writes each line of a multi-line payload CR-terminated, in order', async () => {
      respondPlain(port);
      await repl.sendRaw('a\nb\nc');
      const body = port.written.slice(3, -2);
      expect(body).toEqual([encode('a\r'), encode('b\r'), encode('c\r')]);
      expect(port.written[port.written.length - 2]).toEqual(bytes(0x04));
    });

    it('plain raw fallback sends a single CR for empty content', async () => {
      respondPlain(port);
      await repl.sendRaw('');
      const body = port.written.slice(3, -2);
      expect(body).toEqual([encode('\r')]);
    });

    it('paste mode sends an empty body for empty content', async () => {
      respondPaste(port);
      await repl.sendRaw('');
      // No data chunks between paste-request and Ctrl-D end-of-data.
      const body = port.written.slice(3, -2);
      expect(body).toEqual([]);
    });

    it('only writes the trailing Ctrl-B after the device finishes responding', async () => {
      // Hook the writes manually: respondPlain through Ctrl-D, but snapshot
      // chunk count at the end-of-data Ctrl-D — the Ctrl-B epilogue only
      // appends after the response completes.
      let snapshot: number | null = null;
      port.onWrite = (chunk) => {
        if (isCtrlA(chunk)) {
          port.inject(BANNER);
        } else if (isPasteRequest(chunk)) {
          port.inject(bytes(0x52, 0x00));
        } else if (isCtrlD(chunk)) {
          snapshot = port.written.length;
          port.inject(
            concat([encode('OK'), bytes(0x04), bytes(0x04), encode('>')]),
          );
        }
      };
      await repl.sendRaw('print(1)');
      expect(snapshot).not.toBeNull();
      // At Ctrl-D snapshot: Ctrl-CC, Ctrl-A, paste-req, body, Ctrl-D = 5.
      expect(snapshot!).toBe(5);
      // After resolution Ctrl-B is appended.
      expect(port.written).toHaveLength(6);
      expect(port.written[5]).toEqual(bytes(0x02));
    });

    it('serializes concurrent calls so each prologue/body/epilogue runs contiguously', async () => {
      respondPlain(port);
      await Promise.all([repl.sendRaw('a'), repl.sendRaw('b')]);

      // Each sendRaw now produces 6 chunks:
      //   Ctrl-CC, Ctrl-A, paste-req, body, Ctrl-D, Ctrl-B.
      expect(port.written).toHaveLength(12);

      const expectedFor = (line: string) => [
        bytes(0x03, 0x03),
        bytes(0x01),
        bytes(0x05, 0x41, 0x01),
        encode(`${line}\r`),
        bytes(0x04),
        bytes(0x02),
      ];
      expect(port.written.slice(0, 6)).toEqual(expectedFor('a'));
      expect(port.written.slice(6, 12)).toEqual(expectedFor('b'));
    });

    it('still serializes the next call after the previous one rejects mid-payload', async () => {
      respondPlain(port);
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
      const failedErr = await failed.catch((e) => e);
      expect(failedErr).toBeInstanceOf(ReplDisconnectedError);
      expect((failedErr as Error).cause).toBe(failure);
      // `next` must still be reached — a failed task shouldn't poison the
      // chain. With the connection now considered disconnected it short-
      // circuits with `ReplDisconnectedError` rather than attempting a write.
      await expect(next).rejects.toBeInstanceOf(ReplDisconnectedError);
    });

    it('rejects when a line write fails mid-payload, with no unhandled rejections', async () => {
      respondPlain(port);
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
        const err = await repl.sendRaw('a\nb\nc').catch((e) => e);
        expect(err).toBeInstanceOf(ReplDisconnectedError);
        expect((err as Error).cause).toBe(failure);
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  describe('sendRaw — raw-paste streaming', () => {
    it('respects the initial window by writing chunks no larger than it', async () => {
      respondPaste(port, {windowSize: 4});
      await repl.sendRaw('print(1)'); // 8 bytes
      const body = port.written.slice(3, -2);
      // 8 bytes / 4-byte window → 2 chunks of 4 bytes each.
      expect(body).toEqual([encode('prin'), encode('t(1)')]);
    });

    it('refills the window on each \\x01 flow-control byte', async () => {
      const content = 'x'.repeat(20);
      respondPaste(port, {windowSize: 4});
      await repl.sendRaw(content);
      const body = port.written.slice(3, -2);
      // 20 bytes / 4-byte window → 5 chunks of 4 bytes each.
      expect(body.map((c) => c.length)).toEqual([4, 4, 4, 4, 4]);
      const totalBytes = body.reduce((n, c) => n + c.length, 0);
      expect(totalBytes).toBe(20);
    });

    it('blocks the next chunk until the device sends a \\x01', async () => {
      // Custom hook: send banner + R\\x01 + window=2, but withhold the first
      // \\x01 until we explicitly let it through. Verifies the SUT actually
      // waits, rather than firing all chunks regardless.
      let releaseWindow!: () => void;
      const windowReady = new Promise<void>((r) => {
        releaseWindow = r;
      });
      port.onWrite = async (chunk) => {
        if (isCtrlA(chunk)) {
          port.inject(BANNER);
        } else if (isPasteRequest(chunk)) {
          port.inject(bytes(0x52, 0x01, 0x02, 0x00));
        } else if (chunk.length === 2 && chunk[0] === 0x78 && chunk[1] === 0x78) {
          // First 2-byte data chunk consumed; the SUT will block here.
          // Inject the \\x01 only after the test releases it.
          await windowReady;
          port.inject(bytes(0x01));
        } else if (isCtrlD(chunk)) {
          port.inject(
            concat([bytes(0x04), bytes(0x04), bytes(0x04), encode('>')]),
          );
        }
      };
      const send = repl.sendRaw('xxxx');
      // Give the SUT plenty of time to write the first chunk and stall.
      await new Promise((r) => setTimeout(r, 20));
      // At this point only Ctrl-CC, Ctrl-A, paste-req, and the first
      // 2-byte data chunk should have been written.
      expect(port.written).toHaveLength(4);
      expect(port.written[3]).toEqual(encode('xx'));
      releaseWindow();
      await send;
    });

    it('aborts streaming when the device sends \\x04 flow control, but still sends end-of-data', async () => {
      // Inject \\x04 (abort) instead of \\x01 after the first window. The SUT
      // should stop streaming, send \\x04 end-of-data, and proceed to the
      // response phase.
      let abortInjected = false;
      port.onWrite = (chunk) => {
        if (isCtrlA(chunk)) {
          port.inject(BANNER);
        } else if (isPasteRequest(chunk)) {
          port.inject(bytes(0x52, 0x01, 0x04, 0x00)); // window=4
        } else if (!abortInjected && chunk.length === 4) {
          abortInjected = true;
          port.inject(bytes(0x04)); // abort
        } else if (abortInjected && isCtrlD(chunk)) {
          // SUT's end-of-data: send paste ack + empty stdout/stderr.
          port.inject(
            concat([bytes(0x04), bytes(0x04), bytes(0x04), encode('>')]),
          );
        }
      };
      const result = await repl.sendRaw('aaaabbbbcccc'); // 12 bytes
      // The SUT only wrote the first 4 bytes before the abort; the rest
      // never went out.
      const body = port.written.slice(3, -2);
      expect(body).toEqual([encode('aaaa')]);
      // Last two writes are still Ctrl-D and Ctrl-B.
      expect(port.written[port.written.length - 2]).toEqual(bytes(0x04));
      expect(port.written[port.written.length - 1]).toEqual(bytes(0x02));
      expect(result).toEqual({stdout: '', stderr: ''});
    });

    it('handles content larger than several window increments', async () => {
      const content = 'a'.repeat(2048);
      respondPaste(port, {windowSize: 32});
      const result = await repl.sendRaw(content);
      const body = port.written.slice(3, -2);
      const totalBytes = body.reduce((n, c) => n + c.length, 0);
      expect(totalBytes).toBe(2048);
      // Window-aligned chunks except possibly a smaller final one.
      for (let i = 0; i < body.length - 1; i++) {
        expect(body[i].length).toBeLessThanOrEqual(32);
      }
      expect(result).toEqual({stdout: '', stderr: ''});
    });
  });

  describe('sendRaw — response parser', () => {
    it('returns stdout from a paste-mode response, with empty stderr on success', async () => {
      respondPaste(port, {stdout: '1\r\n'});
      const result = await repl.sendRaw('print(1)');
      expect(result).toEqual({stdout: '1\r\n', stderr: ''});
    });

    it('returns stdout from a plain-mode (R\\x00) response, with empty stderr on success', async () => {
      respondPlain(port, {stdout: '1\r\n'});
      const result = await repl.sendRaw('print(1)');
      expect(result).toEqual({stdout: '1\r\n', stderr: ''});
    });

    it('captures stderr for a runtime exception, with stdout empty', async () => {
      const traceback =
        'Traceback (most recent call last):\r\n' +
        '  File "<stdin>", line 1, in <module>\r\n' +
        'NameError: name \'undefined\' is not defined\r\n';
      respondPaste(port, {stderr: traceback});
      const result = await repl.sendRaw('undefined');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(traceback);
    });

    it('captures both stdout and stderr when the program prints before failing', async () => {
      const traceback = 'Traceback (most recent call last):\r\nZeroDivisionError\r\n';
      respondPaste(port, {stdout: 'partial\r\n', stderr: traceback});
      const result = await repl.sendRaw('print("partial"); 1/0');
      expect(result.stdout).toBe('partial\r\n');
      expect(result.stderr).toBe(traceback);
    });

    it('captures syntax-error tracebacks as stderr', async () => {
      const traceback = 'Traceback (most recent call last):\r\nSyntaxError: invalid syntax\r\n';
      respondPaste(port, {stderr: traceback});
      const result = await repl.sendRaw(')');
      expect(result.stderr).toBe(traceback);
    });

    it('still dispatches a `data` event with every device byte for the xterm mirror', async () => {
      const seen: Uint8Array[] = [];
      repl.addEventListener('data', (e) => {
        seen.push((e as CustomEvent<Uint8Array>).detail);
      });
      respondPaste(port, {stdout: 'hi\r\n'});
      await repl.sendRaw('print("hi")');
      // Concatenated device bytes should include both the banner and the
      // post-Ctrl-D paste-ack/stdout/\\x04/stderr/\\x04/> framing.
      const all = concat(seen);
      expect(all).toEqual(
        concat([
          BANNER,
          bytes(0x52, 0x01, 0x80, 0x00),
          bytes(0x04),
          encode('hi\r\n'),
          bytes(0x04),
          bytes(0x04),
          encode('>'),
        ]),
      );
    });

    it('parses a banner delivered byte-by-byte before the handshake', async () => {
      port.onWrite = (chunk) => {
        if (isCtrlA(chunk)) {
          for (const b of BANNER) port.inject([b]);
        } else if (isPasteRequest(chunk)) {
          port.inject(bytes(0x52, 0x00));
        } else if (isCtrlD(chunk)) {
          port.inject(
            concat([
              encode('OK'),
              encode('ok\r\n'),
              bytes(0x04),
              bytes(0x04),
              encode('>'),
            ]),
          );
        }
      };
      const result = await repl.sendRaw('print("ok")');
      expect(result).toEqual({stdout: 'ok\r\n', stderr: ''});
    });

    it('ignores leftover bytes from a previous program before the banner', async () => {
      const leftover = encode('garbage from the previous run\r\n');
      port.onWrite = (chunk) => {
        if (isCtrlA(chunk)) {
          port.inject(concat([leftover, BANNER]));
        } else if (isPasteRequest(chunk)) {
          port.inject(bytes(0x52, 0x00));
        } else if (isCtrlD(chunk)) {
          port.inject(
            concat([
              encode('OK'),
              encode('done\r\n'),
              bytes(0x04),
              bytes(0x04),
              encode('>'),
            ]),
          );
        }
      };
      const result = await repl.sendRaw('print("done")');
      expect(result).toEqual({stdout: 'done\r\n', stderr: ''});
    });

    it('rejects when the timeout elapses before the response completes', async () => {
      // No respondPlain/respondPaste: the parser sits in the banner phase forever.
      await expect(repl.sendRaw('print(1)', 20)).rejects.toThrow(/timed out/i);
    });

    it('still tries to send Ctrl-B after a timeout so the device leaves raw mode', async () => {
      await expect(repl.sendRaw('print(1)', 20)).rejects.toThrow(/timed out/i);
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

  describe('connectToPort', () => {
    it('opens the supplied port and returns a wired ReplInterface', async () => {
      // beforeEach already ran, but we want a fresh port we control.
      port.endReadable();
      const fresh = new FakeSerialPort();
      const iface = await ReplInterface.connectToPort(fresh as unknown as SerialPort);
      expect(fresh.opened).toBe(true);
      expect(fresh.openOptions).toEqual({baudRate: 115200, dataBits: 8, stopBits: 1});
      // The returned interface dispatches data events from the supplied port.
      const seen: Uint8Array[] = [];
      iface.addEventListener('data', (e) => {
        seen.push((e as CustomEvent<Uint8Array>).detail);
      });
      fresh.inject([0x68, 0x69]);
      await new Promise((r) => setTimeout(r, 0));
      expect(seen).toEqual([bytes(0x68, 0x69)]);
      fresh.endReadable();
    });

    it('does not invoke navigator.serial.requestPort()', async () => {
      // No need to set up navigator.serial — connectToPort skips the chooser.
      port.endReadable();
      const fresh = new FakeSerialPort();
      const nav = navigator as unknown as { serial?: unknown };
      const original = nav.serial;
      delete nav.serial;
      try {
        await expect(
          ReplInterface.connectToPort(fresh as unknown as SerialPort),
        ).resolves.toBeInstanceOf(ReplInterface);
      } finally {
        if (original !== undefined) {
          Object.defineProperty(navigator, 'serial', {
            value: original,
            configurable: true,
          });
        }
        fresh.endReadable();
      }
    });
  });

  describe('getPortInfo', () => {
    it('returns the underlying port USB IDs', () => {
      port.info = {usbVendorId: 0x2e8a, usbProductId: 0x0005};
      const info = repl.getPortInfo();
      expect(info).toEqual({usbVendorId: 0x2e8a, usbProductId: 0x0005});
    });

    it('returns the IDs even when only one is set (non-USB transports)', () => {
      port.info = {usbVendorId: 0x2e8a};
      const info = repl.getPortInfo();
      expect(info).toEqual({usbVendorId: 0x2e8a, usbProductId: undefined});
    });
  });
});
