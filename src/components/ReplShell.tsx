// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface ReplShellProps {
  onData: (handler: (data: Uint8Array) => void) => () => void;
  onInput?: (data: string) => void;
  theme: 'light' | 'dark';
}

const LIGHT_THEME = {
  background: '#eff1f5',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  selectionBackground: '#acb0be',
  black: '#5c5f77',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#ea76cb',
  cyan: '#179299',
  white: '#acb0be',
  brightBlack: '#6c6f85',
  brightRed: '#d20f39',
  brightGreen: '#40a02b',
  brightYellow: '#df8e1d',
  brightBlue: '#1e66f5',
  brightMagenta: '#ea76cb',
  brightCyan: '#179299',
  brightWhite: '#bcc0cc',
};

const DARK_THEME = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  selectionBackground: '#585b70',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
};

export function ReplShell({ onData, onInput, theme }: ReplShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const terminal = new Terminal({
      theme: theme === 'dark' ? DARK_THEME : LIGHT_THEME,
    });
    terminalRef.current = terminal;
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
      terminalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onData, onInput]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.setOption('theme', theme === 'dark' ? DARK_THEME : LIGHT_THEME);
  }, [theme]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />;
}
