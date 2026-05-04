// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

// Window during which we surface a fast startup error (e.g. "Not connected")
// instead of returning "started". Long enough for the synchronous reject path
// in `useReplConnection.runCode`, short enough that real long-running programs
// don't block the agent's tool-call window.
const STARTUP_ERROR_WINDOW_MS = 100;

export class RunEditorTool implements Tool<Record<string, never>, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'run_editor',
      description:
        "Runs the current contents of the user's editor on the connected microcontroller. " +
        "Returns immediately once the program has started; the user watches the program's " +
        'output directly in the REPL. Use this for full programs (event loops, sensor polls) ' +
        'that may run indefinitely. Use run_snippet instead for short evaluations whose ' +
        'output you need back.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(_args: Record<string, never>, ctx: ToolContext): Promise<string> {
    const bindings = this.getBindings();
    const code = bindings.getEditorContent();
    if (!code.trim()) return '(editor is empty)';

    const run = bindings.runCode(code);
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error('aborted'));
      if (ctx.signal?.aborted) {
        onAbort();
        return;
      }
      ctx.signal?.addEventListener('abort', onAbort, {once: true});
    });
    const startupWindow = new Promise<'started'>((resolve) => {
      setTimeout(() => resolve('started'), STARTUP_ERROR_WINDOW_MS);
    });

    const outcome = await Promise.race([run, startupWindow, aborted]);
    if (outcome === 'started') {
      // Detach so a later rejection (mid-run disconnect, sendRaw timeout)
      // doesn't surface as an unhandled promise rejection.
      run.catch(() => {});
      return 'Program started on the device. The user is watching its output in the REPL — do not call read_repl_history unless the user asks about the output.';
    }
    // run resolved within the startup window — short program, just return its output.
    const {stdout, stderr} = outcome;
    if (!stdout && !stderr) return '(no output)';
    if (!stderr) return stdout;
    if (!stdout) return `stderr:\n${stderr}`;
    return `${stdout}\nstderr:\n${stderr}`;
  }
}
