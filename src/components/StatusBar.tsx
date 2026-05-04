// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { PanelBottom, PanelLeft, PanelRight } from 'lucide-react';

interface StatusBarProps {
  leftOpen: boolean;
  replOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRepl: () => void;
  onToggleRight: () => void;
}

export function StatusBar({
  leftOpen,
  replOpen,
  rightOpen,
  onToggleLeft,
  onToggleRepl,
  onToggleRight,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-end h-6 px-2 bg-muted border-t border-border shrink-0">
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleLeft}
          title="Toggle file navigator"
          aria-pressed={leftOpen}
          className={`p-0.5 rounded hover:bg-accent transition-colors ${leftOpen ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          <PanelLeft size={14} />
        </button>
        <button
          onClick={onToggleRepl}
          title="Toggle REPL"
          aria-pressed={replOpen}
          className={`p-0.5 rounded hover:bg-accent transition-colors ${replOpen ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          <PanelBottom size={14} />
        </button>
        <button
          onClick={onToggleRight}
          title="Toggle agent panel"
          aria-pressed={rightOpen}
          className={`p-0.5 rounded hover:bg-accent transition-colors ${rightOpen ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          <PanelRight size={14} />
        </button>
      </div>
    </div>
  );
}
