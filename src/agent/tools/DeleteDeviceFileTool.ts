// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface DeleteDeviceFileArgs {
  path: string;
}

export class DeleteDeviceFileTool implements Tool<DeleteDeviceFileArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'delete_device_file',
      description:
        'Deletes a file at the given absolute device path on the connected microcontroller. ' +
        'Does not delete directories. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute device path (POSIX-style) of the file to delete.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: DeleteDeviceFileArgs): Promise<string> {
    const { deviceFs } = this.getBindings();
    if (deviceFs === null) return 'Device is not connected.';
    await deviceFs.removeFile(args.path);
    return 'ok';
  }
}
