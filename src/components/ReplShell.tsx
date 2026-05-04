// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface ReplShellProps {
  onData: (handler: (data: Uint8Array) => void) => () => void;
  onInput?: (data: string) => void;
}

export function ReplShell({ onData, onInput }: ReplShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const terminal = new Terminal();
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    const unsubscribe = onData((data) => terminal.write(data));

    if (onInput) {
      terminal.onKey(({ key }) => onInput(key));
    }

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(container);

    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [onData, onInput]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />;
}
