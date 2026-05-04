// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AgentPanel } from './AgentPanel';
import type { UseAgentReturn } from '@mast-ai/react-ui';

const mockUseAgent = vi.fn<() => UseAgentReturn>();

vi.mock('@mast-ai/react-ui', () => ({
  useAgent: () => mockUseAgent(),
  ConversationPanel: () => <div data-testid="conversation-panel" />,
}));

function makeAgentReturn(overrides: Partial<UseAgentReturn> = {}): UseAgentReturn {
  return {
    messages: [],
    history: [],
    sendMessage: vi.fn(),
    cancel: vi.fn(),
    isRunning: false,
    reset: vi.fn(),
    pendingApprovals: [],
    isReady: true,
    ...overrides,
  };
}

describe('AgentPanel', () => {
  beforeEach(() => {
    mockUseAgent.mockReset();
  });

  it('renders the embedded ConversationPanel', () => {
    mockUseAgent.mockReturnValue(makeAgentReturn());
    render(<AgentPanel theme="light" />);
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
  });

  it('disables the new-conversation button when no messages exist', () => {
    mockUseAgent.mockReturnValue(makeAgentReturn({ messages: [] }));
    render(<AgentPanel theme="light" />);
    expect(screen.getByTitle('New conversation')).toBeDisabled();
  });

  it('disables the new-conversation button when the agent is not ready', () => {
    mockUseAgent.mockReturnValue(
      makeAgentReturn({
        isReady: false,
        messages: [{ kind: 'user', id: '1', text: 'hi' } as never],
      }),
    );
    render(<AgentPanel theme="light" />);
    expect(screen.getByTitle('New conversation')).toBeDisabled();
  });

  it('enables the button when ready and there is at least one message', () => {
    mockUseAgent.mockReturnValue(
      makeAgentReturn({
        isReady: true,
        messages: [{ kind: 'user', id: '1', text: 'hi' } as never],
      }),
    );
    render(<AgentPanel theme="light" />);
    expect(screen.getByTitle('New conversation')).not.toBeDisabled();
  });

  it('calls reset and onResetConversation when clicked', async () => {
    const reset = vi.fn();
    const onResetConversation = vi.fn();
    mockUseAgent.mockReturnValue(
      makeAgentReturn({
        isReady: true,
        messages: [{ kind: 'user', id: '1', text: 'hi' } as never],
        reset,
      }),
    );
    render(<AgentPanel theme="light" onResetConversation={onResetConversation} />);

    await userEvent.click(screen.getByTitle('New conversation'));

    expect(reset).toHaveBeenCalledOnce();
    expect(onResetConversation).toHaveBeenCalledOnce();
  });
});
