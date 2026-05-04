// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef, useState } from 'react';
import { ReplDisconnectedError, ReplInterface, type RunResult } from '../ReplInterface';

const MAX_HISTORY_LINES = 100;

export type ConnectionState = 'disconnected' | 'connected';

export function useReplConnection() {
  const replRef = useRef<ReplInterface | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [replHistory, setReplHistory] = useState<string[]>([]);
  const handlersRef = useRef<Set<(data: Uint8Array) => void>>(new Set());
  const textBufferRef = useRef('');
  const decoderRef = useRef(new TextDecoder());
  const dataListenerRef = useRef<((e: Event) => void) | null>(null);
  const disconnectListenerRef = useRef<((e: Event) => void) | null>(null);

  const handleData = useCallback((data: Uint8Array) => {
    handlersRef.current.forEach((h) => h(data));

    const text = decoderRef.current.decode(data);
    textBufferRef.current += text;
    const parts = textBufferRef.current.split('\n');
    textBufferRef.current = parts[parts.length - 1];
    const newLines = parts.slice(0, -1);
    if (newLines.length > 0) {
      setReplHistory((prev) => [...prev, ...newLines].slice(-MAX_HISTORY_LINES));
    }
  }, []);

  const connect = useCallback(async () => {
    const repl = await ReplInterface.connect();
    const dataListener = (e: Event) => handleData((e as CustomEvent<Uint8Array>).detail);
    // Fires when the device-side connection drops (cable yanked, USB error,
    // EOF). Explicit user-initiated disconnect removes this before it can fire.
    const disconnectListener = () => {
      if (replRef.current === repl) {
        replRef.current = null;
      }
      if (dataListenerRef.current) {
        repl.removeEventListener('data', dataListenerRef.current);
        dataListenerRef.current = null;
      }
      disconnectListenerRef.current = null;
      setConnectionState('disconnected');
    };
    repl.addEventListener('data', dataListener);
    repl.addEventListener('disconnect', disconnectListener, {once: true});
    dataListenerRef.current = dataListener;
    disconnectListenerRef.current = disconnectListener;
    replRef.current = repl;
    setConnectionState('connected');
  }, [handleData]);

  const disconnect = useCallback(async () => {
    const repl = replRef.current;
    if (repl) {
      if (dataListenerRef.current) {
        repl.removeEventListener('data', dataListenerRef.current);
        dataListenerRef.current = null;
      }
      if (disconnectListenerRef.current) {
        repl.removeEventListener('disconnect', disconnectListenerRef.current);
        disconnectListenerRef.current = null;
      }
      try {
        await repl.disconnect();
      } catch (err) {
        // The interface already tolerates errored streams; this catch is a
        // belt-and-braces guard so a stray rejection can't bubble up to the
        // user's click handler as an unhandled promise rejection.
        if (!(err instanceof ReplDisconnectedError)) throw err;
      }
      replRef.current = null;
    }
    setConnectionState('disconnected');
  }, []);

  const reset = useCallback(async () => {
    if (replRef.current) {
      try {
        await replRef.current.reset();
      } catch (err) {
        // Post-disconnect clicks short-circuit silently. The disconnect
        // event has already (or will) update connectionState to match.
        if (!(err instanceof ReplDisconnectedError)) throw err;
      }
    }
  }, []);

  const runCode = useCallback(async (code: string): Promise<RunResult> => {
    if (!replRef.current) {
      throw new Error('Not connected');
    }
    return replRef.current.sendRaw(code);
  }, []);

  const send = useCallback(async (data: string) => {
    if (replRef.current) {
      try {
        await replRef.current.send(data);
      } catch (err) {
        if (!(err instanceof ReplDisconnectedError)) throw err;
      }
    }
  }, []);

  const onData = useCallback((handler: (data: Uint8Array) => void): (() => void) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }, []);

  return { connectionState, connect, disconnect, reset, runCode, send, replHistory, onData };
}
