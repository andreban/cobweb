// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface ListDeviceFilesArgs {
  path?: string;
}

export class ListDeviceFilesTool implements Tool<ListDeviceFilesArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'list_device_files',
      description:
        'Lists files and directories at the given absolute device path on the connected ' +
        'microcontroller. Path defaults to "/". Directory entries are suffixed with "/" in ' +
        'the output.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute device path (POSIX-style). Defaults to "/".',
          },
        },
        required: [],
        additionalProperties: false,
      },
      scope: 'read',
      requiresApproval: false,
    };
  }

  async call(args: ListDeviceFilesArgs): Promise<string> {
    const { deviceFs } = this.getBindings();
    if (deviceFs === null) return 'Device is not connected.';
    const path = args.path ?? '/';
    const entries = await deviceFs.list(path);
    if (entries.length === 0) return '(empty directory)';
    return entries.map((e) => (e.isDir ? `${e.name}/` : e.name)).join('\n');
  }
}
