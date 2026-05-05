// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface WriteDeviceFileArgs {
  path: string;
  content: string;
}

export class WriteDeviceFileTool implements Tool<WriteDeviceFileArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'write_device_file',
      description:
        'Writes UTF-8 text to a file at the given absolute device path on the connected ' +
        'microcontroller. Overwrites any existing file. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute device path (POSIX-style).',
          },
          content: {
            type: 'string',
            description: 'UTF-8 text to write to the file.',
          },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: WriteDeviceFileArgs): Promise<string> {
    const { deviceFs } = this.getBindings();
    if (deviceFs === null) return 'Device is not connected.';
    await deviceFs.writeText(args.path, args.content);
    return 'ok';
  }
}
