// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';
import { boardNotesKey } from './boardNotesStorage';

export interface BoardNotesWriteArgs {
  content: string;
}

export class BoardNotesWriteTool implements Tool<BoardNotesWriteArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'write_board_notes',
      description:
        'Replaces the persistent notes for the currently connected board with the provided content. Notes are scoped to the board hardware (vendor modules, pin assignments, hardware quirks, useful docs URLs) — NOT to the current application or whatever files happen to be on the device. Do not record filesystem listings, current main.py contents, project-specific code, or anything that would change when a different program is flashed. Prefer edit_board_notes for incremental changes; use this for the first write or full rewrites. The user reviews the proposed content before it is saved.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The new full notes content (markdown).',
          },
        },
        required: ['content'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: BoardNotesWriteArgs): Promise<string> {
    const { boardIdentity } = this.getBindings();
    if (boardIdentity.status === 'disconnected') {
      return 'No board connected. Notes are scoped per-board.';
    }
    if (boardIdentity.status === 'probing') {
      return 'Identifying the connected board… try again in a moment.';
    }
    localStorage.setItem(boardNotesKey(boardIdentity.machineName), args.content);
    return `Saved ${args.content.length} bytes to notes for "${boardIdentity.machineName}".`;
  }
}
