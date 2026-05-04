// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { WriteEditorTool } from './WriteEditorTool';
import type { ToolBindings } from '../wireTools';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
    runCode: async () => ({stdout: '', stderr: ''}),
    getReplHistory: () => [],
    onData: () => () => {},
    deviceFs: null,
    ...overrides,
  };
}

describe('WriteEditorTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new WriteEditorTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('write_editor');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(false);
  });

  it('definition requires the code argument', () => {
    const tool = new WriteEditorTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required).toEqual(['code']);
  });

  it('forwards the code to setEditorContent', async () => {
    const setEditorContent = vi.fn();
    const tool = new WriteEditorTool(() => makeBindings({ setEditorContent }));
    await tool.call({ code: 'print(1)' });
    expect(setEditorContent).toHaveBeenCalledWith('print(1)');
  });

  it('returns a confirmation string', async () => {
    const tool = new WriteEditorTool(() => makeBindings());
    await expect(tool.call({ code: 'x = 1' })).resolves.toBe('Editor updated.');
  });
});
