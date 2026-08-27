// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CobwebApproval } from './CobwebApproval';
import type { PendingApproval, ToolEventEntry } from '@mast-ai/react-ui';

function makeApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    approve: vi.fn(),
    reject: vi.fn(),
    status: 'pending',
    ...overrides,
  };
}

describe('CobwebApproval', () => {
  describe('edit_editor', () => {
    it('renders Reveal button and calls revealEditorRange', async () => {
      const revealEditorRange = vi.fn();
      const entry: ToolEventEntry = {
        id: '1',
        name: 'edit_editor',
        kind: 'tool_call',
        args: { old_string: 'b = 2', new_string: 'b = 20' },
      } as never;

      render(
        <CobwebApproval
          entry={entry}
          approval={makeApproval()}
          getEditorContent={() => 'a = 1\nb = 2\nc = 3\n'}
          revealEditorRange={revealEditorRange}
          readDeviceFile={async () => null}
          getBoardNotes={() => null}
        />,
      );

      // Auto-reveal on mount
      expect(revealEditorRange).toHaveBeenCalledWith(6, 11);

      // Manual click on Reveal
      const revealButton = screen.getByRole('button', { name: 'Reveal' });
      await userEvent.click(revealButton);
      expect(revealEditorRange).toHaveBeenCalledTimes(2);
    });
  });

  describe('edit_device_file', () => {
    it('renders Focus button once loaded and calls focusDeviceFile on click', async () => {
      const focusDeviceFile = vi.fn();
      const readDeviceFile = vi.fn().mockResolvedValue('x = 10\ny = 20\nz = 30\n');
      const entry: ToolEventEntry = {
        id: '2',
        name: 'edit_device_file',
        kind: 'tool_call',
        args: { path: '/main.py', old_string: 'y = 20', new_string: 'y = 200' },
      } as never;

      render(
        <CobwebApproval
          entry={entry}
          approval={makeApproval()}
          getEditorContent={() => ''}
          revealEditorRange={vi.fn()}
          readDeviceFile={readDeviceFile}
          getBoardNotes={() => null}
          focusDeviceFile={focusDeviceFile}
        />,
      );

      const focusButton = await screen.findByRole('button', { name: 'Focus' });
      expect(focusButton).toBeInTheDocument();

      // Ensure it did not auto-reveal or call focusDeviceFile on mount
      expect(focusDeviceFile).not.toHaveBeenCalled();

      // Click Focus button
      await userEvent.click(focusButton);
      expect(focusDeviceFile).toHaveBeenCalledWith('/main.py', 7, 13);
    });

    it('renders binary file warning if file cannot be decoded / read', async () => {
      const readDeviceFile = vi.fn().mockResolvedValue(null);
      const entry: ToolEventEntry = {
        id: '3',
        name: 'edit_device_file',
        kind: 'tool_call',
        args: { path: '/blob.bin', old_string: 'a', new_string: 'b' },
      } as never;

      render(
        <CobwebApproval
          entry={entry}
          approval={makeApproval()}
          getEditorContent={() => ''}
          revealEditorRange={vi.fn()}
          readDeviceFile={readDeviceFile}
          getBoardNotes={() => null}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Cannot edit binary file.')).toBeInTheDocument();
      });
    });
  });
});
