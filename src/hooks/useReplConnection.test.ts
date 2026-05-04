// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReplConnection } from './useReplConnection';
import { ReplInterface } from '../ReplInterface';

function makeMockRepl(): ReplInterface {
  const et = new EventTarget();
  return Object.assign(et, {
    disconnect: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    sendRaw: vi.fn().mockResolvedValue({stdout: '', stderr: ''}),
    send: vi.fn().mockResolvedValue(undefined),
  }) as unknown as ReplInterface;
}

describe('useReplConnection', () => {
  let mockRepl: ReplInterface;

  beforeEach(() => {
    mockRepl = makeMockRepl();
    vi.spyOn(ReplInterface, 'connect').mockResolvedValue(mockRepl);
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
