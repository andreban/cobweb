// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolContext, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

const PROBE_SNIPPET =
  "import sys,gc,os;print(sys.implementation.name,sys.implementation.version,sys.platform,gc.mem_free());print(os.uname().machine)";

const PROBE_TIMEOUT_MS = 5_000;

function parseOutput(stdout: string): string | null {
  const lines = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const m = lines[0]?.match(/^(\S+)\s+\(([^)]+)\)\s+(\S+)\s+(\d+)$/);
  if (!m) return null;
  const [, name, versionTuple, platform, ramStr] = m;
  const version = versionTuple
    .split(', ')
    .filter((p) => /^\d+$/.test(p))
    .join('.');
  const freeRamKb = Math.round(parseInt(ramStr, 10) / 1024);
  const machine = lines[1];
  const boardLabel = machine ?? `${name} on ${platform}`;
  return `Connected board: ${boardLabel} (${name} ${version}, free RAM: ~${freeRamKb} KB)`;
}

export class GetBoardInfoTool implements Tool<Record<string, never>, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'get_board_info',
      description:
        'Queries the connected MicroPython board for its firmware version, platform, and available RAM. ' +
        'Call this at the start of a session to understand what board you are working with.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      scope: 'read',
      requiresApproval: false,
    };
  }

  async call(_args: Record<string, never>, ctx: ToolContext): Promise<string> {
    const run = this.getBindings().runCode(PROBE_SNIPPET);
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error('aborted'));
      if (ctx.signal?.aborted) {
        onAbort();
        return;
      }
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
    });
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), PROBE_TIMEOUT_MS),
    );

    const outcome = await Promise.race([run, timeout, aborted]);
    if (outcome === 'timeout') {
      run.catch(() => {});
      return 'Board info unavailable: probe timed out.';
    }
    const { stdout, stderr } = outcome;
    if (stderr) return `Board info unavailable: ${stderr.trim()}`;
    const result = parseOutput(stdout);
    if (!result) return 'Board info unavailable: unexpected probe output.';
    return result;
  }
}
