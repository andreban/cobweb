// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface MakeDeviceDirArgs {
  path: string;
}

export class MakeDeviceDirTool implements Tool<MakeDeviceDirArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'make_device_dir',
      description:
        'Creates a directory at the given absolute device path on the connected microcontroller. ' +
        'The parent directory must already exist. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute device path (POSIX-style) of the directory to create.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: MakeDeviceDirArgs): Promise<string> {
    const { deviceFs } = this.getBindings();
    if (deviceFs === null) return 'Device is not connected.';
    await deviceFs.mkdir(args.path);
    return 'ok';
  }
}
