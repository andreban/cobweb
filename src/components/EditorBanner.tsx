// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { X } from 'lucide-react';

interface PendingSwitchBannerProps {
  kind: 'pending-switch';
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

interface MessageBannerProps {
  kind: 'message';
  message: string;
  onDismiss: () => void;
}

type EditorBannerProps = PendingSwitchBannerProps | MessageBannerProps;

export function EditorBanner(props: EditorBannerProps) {
  if (props.kind === 'pending-switch') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm bg-amber-100 dark:bg-amber-950 border-b border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100 shrink-0">
        <span className="flex-1">Unsaved changes — what do you want to do?</span>
        <button
          onClick={props.onSave}
          className="px-2 py-0.5 rounded text-xs bg-amber-700 text-white hover:bg-amber-800 transition-colors"
        >
          Save
        </button>
        <button
          onClick={props.onDiscard}
          className="px-2 py-0.5 rounded text-xs bg-amber-200 dark:bg-amber-900 hover:bg-amber-300 dark:hover:bg-amber-800 transition-colors"
        >
          Discard
        </button>
        <button
          onClick={props.onCancel}
          className="px-2 py-0.5 rounded text-xs hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm bg-destructive/10 border-b border-destructive/30 text-destructive shrink-0">
      <span className="flex-1">{props.message}</span>
      <button
        onClick={props.onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
        className="p-0.5 rounded hover:bg-destructive/20 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
