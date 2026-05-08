// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import { DeviceFsError } from '../../DeviceFs';
import type { ToolBindings } from '../wireTools';

export interface OpenDeviceFileInEditorArgs {
  path: string;
}

export class OpenDeviceFileInEditorTool implements Tool<OpenDeviceFileInEditorArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'open_device_file_in_editor',
      description:
        'Reads a file from the device and loads it into the editor in one step. ' +
        'Use this instead of read_device_file + write_editor.',
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

  async call(args: OpenDeviceFileInEditorArgs): Promise<string> {
    const { deviceFs, setEditorContent } = this.getBindings();
    if (deviceFs === null) return 'Device is not connected.';

    let bytes: Uint8Array;
    try {
      bytes = await deviceFs.readBytes(args.path);
    } catch (err) {
      if (err instanceof DeviceFsError) return err.message;
      throw err;
    }

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return 'Cannot open binary file in editor.';
    }

    setEditorContent(text);
    return `Editor opened ${args.path}.`;
  }
}
