// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';
import type { ToolBindings } from '../wireTools';
import { findUniqueOccurrence } from '../../lib/editApproval';

export interface EditEditorArgs {
  old_string: string;
  new_string: string;
}

export class EditEditorTool implements Tool<EditEditorArgs, string> {
  constructor(private getBindings: () => ToolBindings) {}

  definition(): ToolDefinition {
    return {
      name: 'edit_editor',
      description:
        "Replaces a unique substring `old_string` in the user's code editor with `new_string`. " +
        '`old_string` must match the editor contents exactly (including whitespace) and must ' +
        'appear exactly once — include enough surrounding context to disambiguate. Prefer this ' +
        'over `write_editor` for any change that does not rewrite the whole buffer. Requires ' +
        'user approval.',
      parameters: {
        type: 'object',
        properties: {
          old_string: {
            type: 'string',
            description:
              'The exact substring currently in the editor to replace. Must appear exactly once.',
          },
          new_string: {
            type: 'string',
            description: 'The replacement text.',
          },
        },
        required: ['old_string', 'new_string'],
        additionalProperties: false,
      },
      scope: 'write',
      requiresApproval: true,
    };
  }

  async call(args: EditEditorArgs): Promise<string> {
    const { getEditorContent, replaceEditorRange } = this.getBindings();
    const source = getEditorContent();
    const result = findUniqueOccurrence(source, args.old_string);
    if (result.kind === 'missing') return 'old_string not found in editor.';
    if (result.kind === 'ambiguous') {
      return `old_string is ambiguous — appears ${result.count} times. Include more surrounding context.`;
    }
    replaceEditorRange(
      result.index,
      result.index + args.old_string.length,
      args.new_string,
    );
    return 'Editor updated.';
  }
}
