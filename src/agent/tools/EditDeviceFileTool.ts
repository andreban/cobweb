// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';
import { findUniqueOccurrence } from '../../lib/editApproval';

export interface EditDeviceFileArgs {
  path: string;
  old_string: string;
  new_string: string;
}

export class EditDeviceFileTool implements Tool<EditDeviceFileArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'edit_device_file',
      description:
        'Replaces a unique substring `old_string` in the UTF-8 text file at `path` on the ' +
        'connected microcontroller with `new_string`. `old_string` must match the file contents ' +
        'exactly (including whitespace) and must appear exactly once — include enough surrounding ' +
        'context to disambiguate. Prefer this over `write_device_file` for any change that does ' +
        'not rewrite the whole file. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute device path (POSIX-style).',
          },
          old_string: {
            type: 'string',
            description:
              'The exact substring currently in the file to replace. Must appear exactly once.',
          },
          new_string: {
            type: 'string',
            description: 'The replacement text.',
          },
        },
        required: ['path', 'old_string', 'new_string'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: EditDeviceFileArgs): Promise<string> {
    const { deviceFs } = this.getBindings();
    if (deviceFs === null) return 'Device is not connected.';

    const bytes = await deviceFs.readBytes(args.path);
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (err) {
      if (err instanceof TypeError) return 'Cannot edit binary file.';
      throw err;
    }

    const result = findUniqueOccurrence(source, args.old_string);
    if (result.kind === 'missing') return 'old_string not found in file.';
    if (result.kind === 'ambiguous') {
      return `old_string is ambiguous — appears ${result.count} times. Include more surrounding context.`;
    }

    const replaced =
      source.slice(0, result.index) +
      args.new_string +
      source.slice(result.index + args.old_string.length);
    await deviceFs.writeText(args.path, replaced);
    return 'File updated.';
  }
}
