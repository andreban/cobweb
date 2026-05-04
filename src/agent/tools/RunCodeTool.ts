// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface RunCodeArgs {
  code?: string;
}

export interface RunCodeOptions {
  /** Wait this long after the last byte of REPL output before resolving. */
  idleMs?: number;
  /** Hard cap on total wait, even if output keeps streaming. */
  maxMs?: number;
}

const DEFAULT_IDLE_MS = 1000;
const DEFAULT_MAX_MS = 30_000;

export class RunCodeTool implements Tool<RunCodeArgs, string> {
  private readonly idleMs: number;
  private readonly maxMs: number;

  constructor(
    private getBindings: () => ToolBindings,
    options: RunCodeOptions = {},
  ) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  }

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

    const decoder = new TextDecoder();
    let buffer = '';

    return new Promise<string>((resolve, reject) => {
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: (() => void) | null = null;

      const cleanup = () => {
        if (unsubscribe) unsubscribe();
        if (idleTimer) clearTimeout(idleTimer);
        if (maxTimer) clearTimeout(maxTimer);
        ctx.signal?.removeEventListener('abort', onAbort);
      };

      const finish = () => {
        cleanup();
        resolve(buffer);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error('aborted'));
      };

      unsubscribe = bindings.onData((data) => {
        buffer += decoder.decode(data);
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(finish, this.idleMs);
      });

      ctx.signal?.addEventListener('abort', onAbort);

      maxTimer = setTimeout(finish, this.maxMs);
      // If no output ever arrives we still need a cap — reuse maxMs as the
      // initial idle window. The first onData call resets it to idleMs.
      idleTimer = setTimeout(finish, this.maxMs);

      bindings.runCode(code).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }
}
