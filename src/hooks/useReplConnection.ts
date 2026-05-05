// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { ReplDisconnectedError, ReplInterface, type RunResult } from '../ReplInterface';

const MAX_HISTORY_LINES = 100;
const LAST_DEVICE_KEY = 'cobweb:lastDevice';

interface PersistedDevice {
  usbVendorId: number;
  usbProductId: number;
}

function readPersistedDevice(): PersistedDevice | null {
  try {
    const raw = localStorage.getItem(LAST_DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedDevice>;
    if (
      typeof parsed?.usbVendorId !== 'number' ||
      typeof parsed?.usbProductId !== 'number'
    ) {
      return null;
    }
    return {usbVendorId: parsed.usbVendorId, usbProductId: parsed.usbProductId};
  } catch {
    return null;
  }
}

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

  const wireRepl = useCallback((repl: ReplInterface) => {
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

    // Persist the USB IDs so the next page load can auto-reconnect to the
    // same physical device. Quota or unavailable storage is non-fatal — we
    // just lose the auto-reconnect for this session.
    const info = repl.getPortInfo();
    if (info?.usbVendorId !== undefined && info?.usbProductId !== undefined) {
      try {
        localStorage.setItem(
          LAST_DEVICE_KEY,
          JSON.stringify({
            usbVendorId: info.usbVendorId,
            usbProductId: info.usbProductId,
          }),
        );
      } catch {
        // ignore
      }
    }
  }, [handleData]);

  const connect = useCallback(async () => {
    const repl = await ReplInterface.connect();
    wireRepl(repl);
  }, [wireRepl]);

  // Auto-reconnect on mount: if exactly one port granted by the browser
  // matches the persisted USB IDs, open it silently. Zero / multiple matches
  // do nothing — the user can click Connect manually.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.serial) return;
      const target = readPersistedDevice();
      if (!target) return;
      try {
        const ports = await navigator.serial.getPorts();
        const matches = ports.filter((p) => {
          const info = p.getInfo();
          return (
            info.usbVendorId === target.usbVendorId &&
            info.usbProductId === target.usbProductId
          );
        });
        if (matches.length !== 1) return;
        if (cancelled || replRef.current) return;
        const repl = await ReplInterface.connectToPort(matches[0]);
        if (cancelled || replRef.current) {
          // Raced with unmount or a manual connect; discard the orphan.
          await repl.disconnect().catch(() => undefined);
          return;
        }
        wireRepl(repl);
      } catch {
        // Stale port, permission revoked, device removed mid-load, etc.
        // Stay disconnected; the user can click Connect manually.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wireRepl]);

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

  const sendRaw = useCallback(async (code: string): Promise<RunResult> => {
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

  return {
    connectionState,
    connect,
    disconnect,
    reset,
    runCode,
    sendRaw,
    send,
    replHistory,
    onData,
  };
}
