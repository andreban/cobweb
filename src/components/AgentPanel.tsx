// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { ConversationPanel, useAgent } from '@mast-ai/react-ui';
import { SquarePen } from 'lucide-react';

interface AgentPanelProps {
  theme: 'light' | 'dark';
  inputPlaceholder?: string;
  onResetConversation?: () => void;
}

export function AgentPanel({ theme, inputPlaceholder, onResetConversation }: AgentPanelProps) {
  const { reset, messages, isReady } = useAgent();
  const hasMessages = messages.length > 0;

  function handleNewConversation() {
    reset();
    onResetConversation?.();
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between h-8 px-2 border-b border-border bg-muted shrink-0">
        <span className="text-xs font-medium text-muted-foreground">Assistant</span>
        <button
          onClick={handleNewConversation}
          disabled={!isReady || !hasMessages}
          title="New conversation"
          aria-label="New conversation"
          className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <SquarePen size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <ConversationPanel theme={theme} inputPlaceholder={inputPlaceholder} />
      </div>
    </div>
  );
}
