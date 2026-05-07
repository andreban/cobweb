// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { EditEditorTool } from './EditEditorTool';
import type { ToolBindings } from '../wireTools';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
    replaceEditorRange: () => {},
    runCode: async () => ({ stdout: '', stderr: '' }),
    getReplHistory: () => [],
    onData: () => () => {},
    deviceFs: null,
    ...overrides,
  };
}

describe('EditEditorTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new EditEditorTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('edit_editor');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('definition requires both old_string and new_string', () => {
    const tool = new EditEditorTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required ?? []).toEqual([
      'old_string',
      'new_string',
    ]);
  });

  it('returns "old_string not found in editor." when the target is absent', async () => {
    const replaceEditorRange = vi.fn();
    const tool = new EditEditorTool(() =>
      makeBindings({ getEditorContent: () => 'x = 1\n', replaceEditorRange }),
    );
    await expect(
      tool.call({ old_string: 'missing', new_string: 'y' }),
    ).resolves.toBe('old_string not found in editor.');
    expect(replaceEditorRange).not.toHaveBeenCalled();
  });

  it('returns the ambiguous error message when the target appears more than once', async () => {
    const replaceEditorRange = vi.fn();
    const tool = new EditEditorTool(() =>
      makeBindings({
        getEditorContent: () => 'foo\nbar\nfoo\nfoo\n',
        replaceEditorRange,
      }),
    );
    await expect(
      tool.call({ old_string: 'foo', new_string: 'baz' }),
    ).resolves.toBe(
      'old_string is ambiguous — appears 3 times. Include more surrounding context.',
    );
    expect(replaceEditorRange).not.toHaveBeenCalled();
  });

  it('dispatches a targeted range replacement on the unique path', async () => {
    const replaceEditorRange = vi.fn();
    const tool = new EditEditorTool(() =>
      makeBindings({
        getEditorContent: () => 'a = 1\nb = 2\nc = 3\n',
        replaceEditorRange,
      }),
    );
    await expect(
      tool.call({ old_string: 'b = 2', new_string: 'b = 42' }),
    ).resolves.toBe('Editor updated.');
    // 'b = 2' starts at index 6 and is 5 chars long.
    expect(replaceEditorRange).toHaveBeenCalledWith(6, 11, 'b = 42');
  });

  it('handles multi-line replacements', async () => {
    const replaceEditorRange = vi.fn();
    const tool = new EditEditorTool(() =>
      makeBindings({
        getEditorContent: () => 'def f():\n    return 1\n',
        replaceEditorRange,
      }),
    );
    await expect(
      tool.call({
        old_string: 'def f():\n    return 1',
        new_string: 'def f():\n    return 42',
      }),
    ).resolves.toBe('Editor updated.');
    expect(replaceEditorRange).toHaveBeenCalledWith(
      0,
      'def f():\n    return 1'.length,
      'def f():\n    return 42',
    );
  });
});
