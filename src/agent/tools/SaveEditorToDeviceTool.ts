// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import { DeviceFsError } from '../../DeviceFs';
import type { ToolBindings } from '../wireTools';

export interface SaveEditorToDeviceArgs {
  path: string;
}

export class SaveEditorToDeviceTool implements Tool<SaveEditorToDeviceArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'save_editor_to_device',
      description:
        'Saves the current editor contents to a file on the device in one step. ' +
        'Use this instead of read_editor + write_device_file.',
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
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: SaveEditorToDeviceArgs): Promise<string> {
    const { deviceFs, getEditorContent } = this.getBindings();
    if (deviceFs === null) return 'Device is not connected.';
    const content = getEditorContent();
    try {
      await deviceFs.writeText(args.path, content);
    } catch (err) {
      if (err instanceof DeviceFsError) return err.message;
      throw err;
    }
    return `Editor saved to ${args.path}.`;
  }
}
