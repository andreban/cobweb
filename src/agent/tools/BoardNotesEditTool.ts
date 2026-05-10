// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';
import { findUniqueOccurrence } from '../../lib/editApproval';
import { boardNotesKey } from './boardNotesStorage';

export interface BoardNotesEditArgs {
  old_string: string;
  new_string: string;
}

export class BoardNotesEditTool implements Tool<BoardNotesEditArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'edit_board_notes',
      description:
        'Edits the persistent notes for the currently connected board by replacing one occurrence of old_string with new_string. Notes are scoped to the board hardware (vendor modules, pin assignments, hardware quirks, useful docs URLs) — NOT to the current application or files on the device. Do not record filesystem listings, current code contents, or project-specific state. old_string must appear exactly once in the current notes; add surrounding context to disambiguate if necessary. The user reviews the change before it is saved.',
      parameters: {
        type: 'object',
        properties: {
          old_string: {
            type: 'string',
            description:
              'The exact substring currently in the notes to replace. Must appear exactly once.',
          },
          new_string: {
            type: 'string',
            description: 'The replacement text.',
          },
        },
        required: ['old_string', 'new_string'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: BoardNotesEditArgs): Promise<string> {
    const { boardIdentity } = this.getBindings();
    if (boardIdentity.status === 'disconnected') {
      return 'No board connected. Notes are scoped per-board.';
    }
    if (boardIdentity.status === 'probing') {
      return 'Identifying the connected board… try again in a moment.';
    }
    const key = boardNotesKey(boardIdentity.machineName);
    const current = localStorage.getItem(key) ?? '';
    const result = findUniqueOccurrence(current, args.old_string);
    if (result.kind === 'missing') return 'old_string not found in current notes.';
    if (result.kind === 'ambiguous') {
      return `old_string appears ${result.count} times in current notes. Add surrounding context to make it unique.`;
    }
    const updated =
      current.slice(0, result.index) +
      args.new_string +
      current.slice(result.index + args.old_string.length);
    localStorage.setItem(key, updated);
    return `Notes updated for "${boardIdentity.machineName}".`;
  }
}
