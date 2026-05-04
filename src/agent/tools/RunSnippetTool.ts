// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface RunSnippetArgs {
  code: string;
}

// How long we'll wait for a snippet to finish before giving up and telling
// the agent the code is still running. Sits below `ReplInterface.sendRaw`'s
// 30s default so we surface "still running" before the underlying call times
// out.
const SNIPPET_WAIT_MS = 25_000;

export class RunSnippetTool implements Tool<RunSnippetArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'run_snippet',
      description:
        'Evaluates a short MicroPython snippet on the connected microcontroller and returns ' +
        "stdout/stderr. Use this for quick checks (sensor reads, expression eval, library probes) " +
        'where you need the output back. For long-running programs, use run_editor instead.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The MicroPython code to evaluate.',
          },
        },
        required: ['code'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: RunSnippetArgs, ctx: ToolContext): Promise<string> {
    if (!args.code.trim()) return '(empty snippet)';

    const run = this.getBindings().runCode(args.code);
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error('aborted'));
      if (ctx.signal?.aborted) {
        onAbort();
        return;
      }
      ctx.signal?.addEventListener('abort', onAbort, {once: true});
    });
    const timeout = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), SNIPPET_WAIT_MS);
    });

    const outcome = await Promise.race([run, timeout, aborted]);
    if (outcome === 'timeout') {
      // Detach so a later rejection doesn't surface as an unhandled rejection.
      run.catch(() => {});
      return '(snippet still running after wait window — output is streaming to the REPL; use read_repl_history to inspect it)';
    }
    const {stdout, stderr} = outcome;
    if (!stdout && !stderr) return '(no output)';
    if (!stderr) return stdout;
    if (!stdout) return `stderr:\n${stderr}`;
    return `${stdout}\nstderr:\n${stderr}`;
  }
}
