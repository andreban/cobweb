// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface RunCodeArgs {
  code?: string;
}

export class RunCodeTool implements Tool<RunCodeArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'run_code',
      description:
        'Executes MicroPython code on the connected microcontroller and returns the REPL output. ' +
        'If no code is provided, runs the current editor contents.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'The MicroPython code to run. Omit to run the current editor contents.',
          },
        },
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: RunCodeArgs, ctx: ToolContext): Promise<string> {
    const bindings = this.getBindings();
    const code = args.code ?? bindings.getEditorContent();
    if (!code.trim()) return '(no code to run)';

    const run = bindings.runCode(code);
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error('aborted'));
      if (ctx.signal?.aborted) {
        onAbort();
        return;
      }
      ctx.signal?.addEventListener('abort', onAbort, {once: true});
    });

    const {stdout, stderr} = await Promise.race([run, aborted]);

    if (!stdout && !stderr) return '(no output)';
    if (!stderr) return stdout;
    if (!stdout) return `stderr:\n${stderr}`;
    return `${stdout}\nstderr:\n${stderr}`;
  }
}
