// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { ReadEditorTool } from './ReadEditorTool';
import type { ToolBindings } from '../wireTools';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
    replaceEditorRange: () => {},
    runCode: async () => ({stdout: '', stderr: ''}),
    getReplHistory: () => [],
    onData: () => () => {},
    deviceFs: null,
    ...overrides,
  };
}

describe('ReadEditorTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new ReadEditorTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('read_editor');
    expect(def.scope).toBe('read');
    expect(def.requiresApproval).toBe(false);
  });

  it('returns the current editor content', async () => {
    const bindings = makeBindings({ getEditorContent: () => 'print("hi")' });
    const tool = new ReadEditorTool(() => bindings);
    await expect(tool.call()).resolves.toBe('print("hi")');
  });

  it('reads bindings lazily via the getter', async () => {
    let content = 'first';
    const bindings = makeBindings({ getEditorContent: () => content });
    const tool = new ReadEditorTool(() => bindings);
    expect(await tool.call()).toBe('first');
    content = 'second';
    expect(await tool.call()).toBe('second');
  });
});
