// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export class StopProgramTool implements Tool<Record<string, never>, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'stop_program',
      description:
        'Sends a keyboard interrupt (Ctrl+C) to the connected device, stopping any running program and returning to the REPL prompt. Use this to stop a program started with run_editor or a snippet that is still running.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: false,
    };
  }

  async call(): Promise<string> {
    this.getBindings().sendInterrupt();
    return 'Interrupt sent.';
  }
}
