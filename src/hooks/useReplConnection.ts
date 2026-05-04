// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef, useState } from 'react';
import { ReplInterface } from '../ReplInterface';

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
      await repl.disconnect();
      replRef.current = null;
    }
    setConnectionState('disconnected');
  }, []);

  const reset = useCallback(async () => {
    if (replRef.current) {
      await replRef.current.reset();
    }
  }, []);

  const runCode = useCallback(async (code: string) => {
    if (replRef.current) {
      await replRef.current.sendRaw(code);
    }
  }, []);

  const send = useCallback(async (data: string) => {
    if (replRef.current) {
      await replRef.current.send(data);
    }
  }, []);

  const onData = useCallback((handler: (data: Uint8Array) => void): (() => void) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }, []);

  return { connectionState, connect, disconnect, reset, runCode, send, replHistory, onData };
}
