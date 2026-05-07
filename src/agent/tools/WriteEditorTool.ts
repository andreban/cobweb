// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface WriteEditorArgs {
  code: string;
}

export class WriteEditorTool implements Tool<WriteEditorArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'write_editor',
      description:
        "Replaces the entire contents of the user's code editor with the given code. Use " +
        'this only for new programs or full rewrites; use `edit_editor` for partial changes. ' +
        'Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The new code to place in the editor.',
          },
        },
        required: ['code'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: WriteEditorArgs): Promise<string> {
    this.getBindings().setEditorContent(args.code);
    return 'Editor updated.';
  }
}
