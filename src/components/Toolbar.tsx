// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { Moon, Play, Plug, RotateCcw, Settings, Sun, Unplug } from 'lucide-react';

type ConnectionState = 'disconnected' | 'connected';

interface ToolbarProps {
  connectionState: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
  onReset: () => void;
  onRun: () => void;
  onOpenSettings: () => void;
  isAgentConfigured: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function Toolbar({
  connectionState,
  onConnect,
  onDisconnect,
  onReset,
  onRun,
  onOpenSettings,
  theme,
  onToggleTheme,
}: ToolbarProps) {
  const connected = connectionState === 'connected';

  return (
    <div className="flex items-center gap-2 h-10 px-3 bg-muted border-b border-border shrink-0">
      <span className="text-sm font-semibold mr-2">Cobweb</span>

      <div className="flex items-center gap-1">
        {connected ? (
          <button
            onClick={onDisconnect}
            title="Disconnect"
            className="flex items-center gap-1.5 px-2 py-1 rounded text-sm hover:bg-accent transition-colors text-green-600 dark:text-green-400"
          >
            <Unplug size={14} />
            Disconnect
          </button>
        ) : (
          <button
            onClick={onConnect}
            title="Connect to device"
            className="flex items-center gap-1.5 px-2 py-1 rounded text-sm hover:bg-accent transition-colors"
          >
            <Plug size={14} />
            Connect
          </button>
        )}

        <button
          onClick={onReset}
          disabled={!connected}
          title="Reset device"
          className="flex items-center gap-1.5 px-2 py-1 rounded text-sm hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw size={14} />
          Reset
        </button>

        <button
          onClick={onRun}
          disabled={!connected}
          title="Run current file"
          className="flex items-center gap-1.5 px-2 py-1 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play size={14} />
          Run
        </button>
      </div>

      <div className="flex-1" />

      <button
        onClick={onToggleTheme}
        title="Toggle theme"
        className="p-1.5 rounded hover:bg-accent transition-colors"
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      <button
        onClick={onOpenSettings}
        title="Settings"
        className="p-1.5 rounded hover:bg-accent transition-colors"
      >
        <Settings size={14} />
      </button>
    </div>
  );
}
