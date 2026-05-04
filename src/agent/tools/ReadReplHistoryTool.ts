// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface ReadReplHistoryArgs {
  lines?: number;
}

const DEFAULT_LINES = 20;

export class ReadReplHistoryTool implements Tool<ReadReplHistoryArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'read_repl_history',
      description:
        'Returns the last N lines of REPL output from the connected microcontroller, joined by newlines.',
      parameters: {
        type: 'object',
        properties: {
          lines: {
            type: 'number',
            description: `Number of trailing lines to return. Defaults to ${DEFAULT_LINES}.`,
          },
        },
        additionalProperties: false,
      },
      scope: 'read',
      requiresApproval: false,
    };
  }

  async call(args: ReadReplHistoryArgs): Promise<string> {
    const n = args.lines ?? DEFAULT_LINES;
    const history = this.getBindings().getReplHistory();
    return history.slice(-n).join('\n');
  }
}
