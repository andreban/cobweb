// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface RunDeviceFileArgs {
  path: string;
}

const STARTUP_ERROR_WINDOW_MS = 100;

export class RunDeviceFileTool implements Tool<RunDeviceFileArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'run_device_file',
      description:
        'Executes a Python file directly from the connected microcontroller filesystem. ' +
        "Returns immediately once the program has started; the user watches the program's " +
        'output directly in the REPL. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute device path (POSIX-style, e.g. "main.py" or "/main.py").',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: RunDeviceFileArgs, ctx: ToolContext): Promise<string> {
    const bindings = this.getBindings();
    const rawPath = args.path.trim();
    if (!rawPath) return '(path is empty)';

    const sanitizedPath = rawPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const code = `exec(open('${sanitizedPath}').read())`;

    const run = bindings.runCode(code);
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error('aborted'));
      if (ctx.signal?.aborted) {
        onAbort();
        return;
      }
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
    });
    const startupWindow = new Promise<'started'>((resolve) => {
      setTimeout(() => resolve('started'), STARTUP_ERROR_WINDOW_MS);
    });

    const outcome = await Promise.race([run, startupWindow, aborted]);
    if (outcome === 'started') {
      run.catch(() => {});
      return `Program ${rawPath} started on the device. The user is watching its output in the REPL — do not call read_repl_history unless the user asks about the output.`;
    }

    const { stdout, stderr } = outcome;
    if (!stdout && !stderr) return '(no output)';
    if (!stderr) return stdout;
    if (!stdout) return `stderr:\n${stderr}`;
    return `${stdout}\nstderr:\n${stderr}`;
  }
}
