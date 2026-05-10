// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import type { BoardIdentity } from '../agent/wireTools';
import type { RunResult } from '../ReplInterface';
import type { ConnectionState } from './useReplConnection';

const PROBE_SNIPPET = 'import os; print(os.uname().machine)';

interface UseMachineNameArgs {
  connectionState: ConnectionState;
  runCode: (code: string) => Promise<RunResult>;
}

/**
 * Probes `os.uname().machine` once per connect transition and surfaces the
 * result as a discriminated `BoardIdentity` so notes tools can distinguish
 * "no board" from "board connected, identifying it".
 */
export function useMachineName(args: UseMachineNameArgs): BoardIdentity {
  const { connectionState, runCode } = args;
  // Lazy-init so a hook mounted with an already-connected board starts in
  // 'probing' rather than briefly reporting 'disconnected'.
  const [identity, setIdentity] = useState<BoardIdentity>(() =>
    connectionState === 'connected'
      ? { status: 'probing' }
      : { status: 'disconnected' },
  );
  // Reset to a connection-derived baseline whenever connectionState changes,
  // using the documented "adjust state during render" pattern. The async
  // probe below then writes 'ready' once stdout returns.
  const [prevState, setPrevState] = useState<ConnectionState>(connectionState);
  if (prevState !== connectionState) {
    setPrevState(connectionState);
    setIdentity(
      connectionState === 'connected'
        ? { status: 'probing' }
        : { status: 'disconnected' },
    );
  }

  useEffect(() => {
    if (connectionState !== 'connected') return;
    let cancelled = false;
    (async () => {
      try {
        const { stdout } = await runCode(PROBE_SNIPPET);
        if (cancelled) return;
        const value = stdout.trim();
        // Empty probe output keeps status === 'probing' rather than
        // misrepresenting it as ready-with-empty-name. The agent retries
        // on the next turn (cheap; same as a transient REPL hiccup).
        if (value) setIdentity({ status: 'ready', machineName: value });
      } catch {
        // Probe failure leaves status === 'probing'; the agent's next
        // notes-touching turn surfaces the "still identifying" message
        // rather than silently degrading to disconnected-shaped errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionState, runCode]);

  return identity;
}
