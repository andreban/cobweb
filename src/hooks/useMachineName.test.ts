// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMachineName } from './useMachineName';
import type { RunResult } from '../ReplInterface';
import type { ConnectionState } from './useReplConnection';

function makeRunCode(impl: () => Promise<RunResult>) {
  return vi.fn(impl);
}

describe('useMachineName', () => {
  it('starts in disconnected state', () => {
    const runCode = makeRunCode(async () => ({ stdout: '', stderr: '' }));
    const { result } = renderHook(() =>
      useMachineName({ connectionState: 'disconnected', runCode }),
    );
    expect(result.current).toEqual({ status: 'disconnected' });
    expect(runCode).not.toHaveBeenCalled();
  });

  it('flips to probing then ready with the trimmed machine string on connect', async () => {
    const runCode = makeRunCode(async () => ({
      stdout: '  Raspberry Pi Pico with RP2040  \n',
      stderr: '',
    }));
    const { result, rerender } = renderHook(
      ({ state }: { state: ConnectionState }) =>
        useMachineName({ connectionState: state, runCode }),
      { initialProps: { state: 'disconnected' as ConnectionState } },
    );
    expect(result.current).toEqual({ status: 'disconnected' });

    rerender({ state: 'connected' });
    expect(result.current).toEqual({ status: 'probing' });
    expect(runCode).toHaveBeenCalledWith('import os; print(os.uname().machine)');

    await waitFor(() =>
      expect(result.current).toEqual({
        status: 'ready',
        machineName: 'Raspberry Pi Pico with RP2040',
      }),
    );
  });

  it('keeps status === probing when probe stdout is empty', async () => {
    const runCode = makeRunCode(async () => ({ stdout: '   \n', stderr: '' }));
    const { result } = renderHook(() =>
      useMachineName({ connectionState: 'connected', runCode }),
    );
    await waitFor(() => expect(runCode).toHaveBeenCalled());
    // Allow microtasks to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toEqual({ status: 'probing' });
  });

  it('keeps status === probing when runCode rejects', async () => {
    const runCode = makeRunCode(async () => {
      throw new Error('Not connected');
    });
    const { result } = renderHook(() =>
      useMachineName({ connectionState: 'connected', runCode }),
    );
    await waitFor(() => expect(runCode).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toEqual({ status: 'probing' });
  });

  it('flips back to disconnected when connection drops', async () => {
    const runCode = makeRunCode(async () => ({ stdout: 'Pico\n', stderr: '' }));
    const { result, rerender } = renderHook(
      ({ state }: { state: ConnectionState }) =>
        useMachineName({ connectionState: state, runCode }),
      { initialProps: { state: 'connected' as ConnectionState } },
    );
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', machineName: 'Pico' }),
    );

    rerender({ state: 'disconnected' });
    expect(result.current).toEqual({ status: 'disconnected' });
  });

  it('re-probes on reconnect', async () => {
    const runCode = makeRunCode(async () => ({ stdout: 'BoardA\n', stderr: '' }));
    const { result, rerender } = renderHook(
      ({ state }: { state: ConnectionState }) =>
        useMachineName({ connectionState: state, runCode }),
      { initialProps: { state: 'connected' as ConnectionState } },
    );
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', machineName: 'BoardA' }),
    );

    rerender({ state: 'disconnected' });
    expect(result.current).toEqual({ status: 'disconnected' });

    runCode.mockResolvedValueOnce({ stdout: 'BoardB\n', stderr: '' });
    rerender({ state: 'connected' });
    expect(result.current).toEqual({ status: 'probing' });
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', machineName: 'BoardB' }),
    );
    expect(runCode).toHaveBeenCalledTimes(2);
  });
});
