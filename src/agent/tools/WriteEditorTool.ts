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
        "Replaces the entire contents of the user's code editor with the given code.",
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
      requiresApproval: false,
    };
  }

  async call(args: WriteEditorArgs): Promise<string> {
    this.getBindings().setEditorContent(args.code);
    return 'Editor updated.';
  }
}
