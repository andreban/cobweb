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
        'Reads a file from the device and loads it into the editor so the human user can view or edit it interactively. ' +
        'DO NOT use this tool if your goal is to edit or inspect a device file yourself — use edit_device_file or read_device_file directly instead.',
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
    const { deviceFs, setOriginAndContent } = this.getBindings();
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

    setOriginAndContent({ kind: 'device', path: args.path }, text);
    return `Editor opened ${args.path}.`;
  }
}
