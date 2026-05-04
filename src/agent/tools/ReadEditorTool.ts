// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export class ReadEditorTool implements Tool<Record<string, never>, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'read_editor',
      description: "Returns the current contents of the user's code editor as a string.",
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
    return this.getBindings().getEditorContent();
  }
}
