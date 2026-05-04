// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';

export interface ReadDeviceFileArgs {
  path: string;
}

export class ReadDeviceFileTool implements Tool<ReadDeviceFileArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'read_device_file',
      description:
        'Reads a UTF-8 text file at the given absolute device path on the connected ' +
        'microcontroller. Returns "binary file — cannot read" if the file is not valid UTF-8.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute device path (POSIX-style).',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      scope: 'read',
      requiresApproval: false,
    };
  }

  async call(args: ReadDeviceFileArgs): Promise<string> {
    const { deviceFs } = this.getBindings();
    if (deviceFs === null) return 'Device is not connected.';
    try {
      return await deviceFs.readText(args.path);
    } catch (err) {
      // DeviceFs.readText wraps TextDecoder TypeErrors as Error with the
      // TypeError attached as `cause`. Translate that to a tool-level message;
      // let every other error (DeviceFsError, ReplDisconnectedError, …) pass.
      if (err instanceof Error && err.cause instanceof TypeError) {
        return 'binary file — cannot read';
      }
      throw err;
    }
  }
}
