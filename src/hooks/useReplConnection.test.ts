// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReplConnection } from './useReplConnection';
import { ReplDisconnectedError, ReplInterface } from '../ReplInterface';

const LAST_DEVICE_KEY = 'cobweb:lastDevice';

function makeMockRepl(
  info: { usbVendorId?: number; usbProductId?: number } | null = {
    usbVendorId: 0x2e8a,
    usbProductId: 0x0005,
  },
): ReplInterface {
  const et = new EventTarget();
  return Object.assign(et, {
    disconnect: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    sendRaw: vi.fn().mockResolvedValue({stdout: '', stderr: ''}),
    send: vi.fn().mockResolvedValue(undefined),
    getPortInfo: vi.fn().mockReturnValue(info),
  }) as unknown as ReplInterface;
}

function fakePort(usbVendorId?: number, usbProductId?: number): SerialPort {
  return {
    getInfo: () => ({usbVendorId, usbProductId}),
  } as unknown as SerialPort;
}

/**
 * Installs a fake `navigator.serial` exposing only `getPorts`. Returns a
 * teardown that restores the original.
 */
function installFakeSerial(ports: SerialPort[]): () => void {
  const nav = navigator as unknown as { serial?: unknown };
  const original = Object.prototype.hasOwnProperty.call(nav, 'serial')
    ? nav.serial
    : undefined;
  Object.defineProperty(navigator, 'serial', {
    value: { getPorts: vi.fn().mockResolvedValue(ports) },
    configurable: true,
  });
  return () => {
    if (original === undefined) {
      delete nav.serial;
    } else {
      Object.defineProperty(navigator, 'serial', {
        value: original,
        configurable: true,
      });
    }
  };
}

describe('useReplConnection', () => {
  let mockRepl: ReplInterface;

  beforeEach(() => {
    localStorage.clear();
    mockRepl = makeMockRepl();
    vi.spyOn(ReplInterface, 'connect').mockResolvedValue(mockRepl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('starts disconnected', () => {
    const { result } = renderHook(() => useReplConnection());
    expect(result.current.connectionState).toBe('disconnected');
  });

  it('connect() sets connectionState to connected', async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());
    expect(result.current.connectionState).toBe('connected');
  });

  it('disconnect() sets connectionState to disconnected', async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());
    await act(() => result.current.disconnect());
    expect(result.current.connectionState).toBe('disconnected');
  });

  it('disconnect() calls repl.disconnect()', async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());
    await act(() => result.current.disconnect());
    expect(mockRepl.disconnect).toHaveBeenCalledOnce();
  });

  it('reset() calls repl.reset()', async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());
    await act(() => result.current.reset());
    expect(mockRepl.reset).toHaveBeenCalledOnce();
  });

  it('runCode() calls repl.sendRaw() with the given code', async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());
    await act(() => result.current.runCode('print("hello")'));
    expect(mockRepl.sendRaw).toHaveBeenCalledWith('print("hello")');
  });

  it("runCode() resolves with the device's stdout/stderr", async () => {
    (mockRepl.sendRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      stdout: 'hi\n',
      stderr: '',
    });
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());
    let runResult: {stdout: string; stderr: string} | undefined;
    await act(async () => {
      runResult = await result.current.runCode('print("hi")');
    });
    expect(runResult).toEqual({stdout: 'hi\n', stderr: ''});
  });

  it('runCode() rejects when not connected', async () => {
    const { result } = renderHook(() => useReplConnection());
    await expect(result.current.runCode('print("hi")')).rejects.toThrow(/not connected/i);
  });

  it('sendRaw() calls repl.sendRaw() with the given code', async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());
    await act(() => result.current.sendRaw('import os'));
    expect(mockRepl.sendRaw).toHaveBeenCalledWith('import os');
  });

  it("sendRaw() resolves with the device's stdout/stderr", async () => {
    (mockRepl.sendRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      stdout: '["main.py"]',
      stderr: '',
    });
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());
    let runResult: {stdout: string; stderr: string} | undefined;
    await act(async () => {
      runResult = await result.current.sendRaw('import os; print(os.listdir("/"))');
    });
    expect(runResult).toEqual({stdout: '["main.py"]', stderr: ''});
  });

  it('sendRaw() rejects when not connected', async () => {
    const { result } = renderHook(() => useReplConnection());
    await expect(result.current.sendRaw('import os')).rejects.toThrow(/not connected/i);
  });

  it('onData handler receives data dispatched by repl', async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());

    const received: Uint8Array[] = [];
    result.current.onData((d) => received.push(d));

    const data = new Uint8Array([72, 101, 108, 108, 111]);
    act(() => {
      (mockRepl as unknown as EventTarget).dispatchEvent(
        new CustomEvent('data', { detail: data }),
      );
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(data);
  });

  it('replHistory updates when newline-terminated data is received', async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());

    const encoder = new TextEncoder();
    act(() => {
      (mockRepl as unknown as EventTarget).dispatchEvent(
        new CustomEvent('data', { detail: encoder.encode('line1\nline2\n') }),
      );
    });

    expect(result.current.replHistory).toContain('line1');
    expect(result.current.replHistory).toContain('line2');
  });

  it("transitions to 'disconnected' when the repl dispatches a 'disconnect' event", async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());
    expect(result.current.connectionState).toBe('connected');

    act(() => {
      (mockRepl as unknown as EventTarget).dispatchEvent(
        new CustomEvent('disconnect', { detail: { error: new Error('cable yanked') } }),
      );
    });

    expect(result.current.connectionState).toBe('disconnected');
  });

  describe('post-disconnect tolerance', () => {
    it('reset() swallows ReplDisconnectedError so click handlers see no rejection', async () => {
      (mockRepl.reset as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ReplDisconnectedError(),
      );
      const { result } = renderHook(() => useReplConnection());
      await act(() => result.current.connect());
      await expect(result.current.reset()).resolves.toBeUndefined();
    });

    it('send() swallows ReplDisconnectedError', async () => {
      (mockRepl.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ReplDisconnectedError(),
      );
      const { result } = renderHook(() => useReplConnection());
      await act(() => result.current.connect());
      await expect(result.current.send('x')).resolves.toBeUndefined();
    });

    it('disconnect() swallows ReplDisconnectedError', async () => {
      (mockRepl.disconnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ReplDisconnectedError(),
      );
      const { result } = renderHook(() => useReplConnection());
      await act(() => result.current.connect());
      await act(() => result.current.disconnect());
      expect(result.current.connectionState).toBe('disconnected');
    });

    it('reset() still propagates non-disconnect errors', async () => {
      const boom = new Error('something else broke');
      (mockRepl.reset as ReturnType<typeof vi.fn>).mockRejectedValueOnce(boom);
      const { result } = renderHook(() => useReplConnection());
      await act(() => result.current.connect());
      await expect(result.current.reset()).rejects.toBe(boom);
    });
  });

  describe('persistence — last device', () => {
    it('writes USB IDs to localStorage after a successful connect', async () => {
      const { result } = renderHook(() => useReplConnection());
      await act(() => result.current.connect());
      const stored = localStorage.getItem(LAST_DEVICE_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual({
        usbVendorId: 0x2e8a,
        usbProductId: 0x0005,
      });
    });

    it('does not write when the port reports no USB IDs', async () => {
      mockRepl = makeMockRepl({});
      vi.spyOn(ReplInterface, 'connect').mockResolvedValue(mockRepl);
      const { result } = renderHook(() => useReplConnection());
      await act(() => result.current.connect());
      expect(localStorage.getItem(LAST_DEVICE_KEY)).toBeNull();
    });

    it('does not clear the persisted entry on user-initiated disconnect', async () => {
      const { result } = renderHook(() => useReplConnection());
      await act(() => result.current.connect());
      await act(() => result.current.disconnect());
      const stored = localStorage.getItem(LAST_DEVICE_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual({
        usbVendorId: 0x2e8a,
        usbProductId: 0x0005,
      });
    });
  });

  describe('auto-reconnect on mount', () => {
    beforeEach(() => {
      localStorage.setItem(
        LAST_DEVICE_KEY,
        JSON.stringify({usbVendorId: 0x2e8a, usbProductId: 0x0005}),
      );
    });

    it('connects when exactly one granted port matches the persisted IDs', async () => {
      const matching = fakePort(0x2e8a, 0x0005);
      const teardown = installFakeSerial([matching]);
      const connectToPort = vi
        .spyOn(ReplInterface, 'connectToPort')
        .mockResolvedValue(mockRepl);
      try {
        const { result } = renderHook(() => useReplConnection());
        // Allow the mount-time effect's promise chain to settle.
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(connectToPort).toHaveBeenCalledWith(matching);
        expect(result.current.connectionState).toBe('connected');
      } finally {
        teardown();
      }
    });

    it('does nothing when zero granted ports match', async () => {
      const teardown = installFakeSerial([fakePort(0x1234, 0x5678)]);
      const connectToPort = vi.spyOn(ReplInterface, 'connectToPort');
      try {
        const { result } = renderHook(() => useReplConnection());
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(connectToPort).not.toHaveBeenCalled();
        expect(result.current.connectionState).toBe('disconnected');
      } finally {
        teardown();
      }
    });

    it('does nothing when multiple granted ports match (ambiguous)', async () => {
      const teardown = installFakeSerial([
        fakePort(0x2e8a, 0x0005),
        fakePort(0x2e8a, 0x0005),
      ]);
      const connectToPort = vi.spyOn(ReplInterface, 'connectToPort');
      try {
        const { result } = renderHook(() => useReplConnection());
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(connectToPort).not.toHaveBeenCalled();
        expect(result.current.connectionState).toBe('disconnected');
      } finally {
        teardown();
      }
    });

    it('does nothing when no device is persisted', async () => {
      localStorage.removeItem(LAST_DEVICE_KEY);
      const teardown = installFakeSerial([fakePort(0x2e8a, 0x0005)]);
      const connectToPort = vi.spyOn(ReplInterface, 'connectToPort');
      try {
        const { result } = renderHook(() => useReplConnection());
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(connectToPort).not.toHaveBeenCalled();
        expect(result.current.connectionState).toBe('disconnected');
      } finally {
        teardown();
      }
    });

    it('swallows errors thrown by connectToPort', async () => {
      const teardown = installFakeSerial([fakePort(0x2e8a, 0x0005)]);
      vi.spyOn(ReplInterface, 'connectToPort').mockRejectedValue(
        new Error('port stale'),
      );
      try {
        const { result } = renderHook(() => useReplConnection());
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(result.current.connectionState).toBe('disconnected');
      } finally {
        teardown();
      }
    });

    it('is a no-op when navigator.serial is unavailable', async () => {
      const nav = navigator as unknown as { serial?: unknown };
      const original = nav.serial;
      delete nav.serial;
      try {
        const { result } = renderHook(() => useReplConnection());
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(result.current.connectionState).toBe('disconnected');
      } finally {
        if (original !== undefined) {
          Object.defineProperty(navigator, 'serial', {
            value: original,
            configurable: true,
          });
        }
      }
    });

    it('ignores malformed JSON in the persisted entry', async () => {
      localStorage.setItem(LAST_DEVICE_KEY, '{not json');
      const teardown = installFakeSerial([fakePort(0x2e8a, 0x0005)]);
      const connectToPort = vi.spyOn(ReplInterface, 'connectToPort');
      try {
        const { result } = renderHook(() => useReplConnection());
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(connectToPort).not.toHaveBeenCalled();
        expect(result.current.connectionState).toBe('disconnected');
      } finally {
        teardown();
      }
    });
  });

  it('onData returns unsubscribe that stops delivery', async () => {
    const { result } = renderHook(() => useReplConnection());
    await act(() => result.current.connect());

    const received: Uint8Array[] = [];
    const unsubscribe = result.current.onData((d) => received.push(d));
    unsubscribe();

    act(() => {
      (mockRepl as unknown as EventTarget).dispatchEvent(
        new CustomEvent('data', { detail: new Uint8Array([72]) }),
      );
    });

    expect(received).toHaveLength(0);
  });
});
