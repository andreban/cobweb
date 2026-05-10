// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';
import { boardNotesKey } from './boardNotesStorage';

export class BoardNotesReadTool implements Tool<Record<string, never>, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'read_board_notes',
      description:
        'Reads the persistent notes for the currently connected board. Notes are scoped per-board (by os.uname().machine) and survive across sessions. Notes describe the board itself — vendor module surface, pin assignments, hardware quirks, useful docs URLs — not whatever happens to be on its filesystem at the moment. Use list_device_files / read_device_file to inspect application state; use this to recall durable board facts the agent established in previous conversations. Returns "" if no notes exist yet.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      scope: 'read',
      requiresApproval: false,
    };
  }

  async call(): Promise<string> {
    const { boardIdentity } = this.getBindings();
    if (boardIdentity.status === 'disconnected') {
      return 'No board connected. Notes are scoped per-board; connect a device to read its notes.';
    }
    if (boardIdentity.status === 'probing') {
      return 'Identifying the connected board… try again in a moment.';
    }
    return localStorage.getItem(boardNotesKey(boardIdentity.machineName)) ?? '';
  }
}
