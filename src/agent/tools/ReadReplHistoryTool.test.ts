// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { ReadReplHistoryTool } from './ReadReplHistoryTool';
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

describe('ReadReplHistoryTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new ReadReplHistoryTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('read_repl_history');
    expect(def.scope).toBe('read');
    expect(def.requiresApproval).toBe(false);
  });

  it('returns the last 20 lines by default, joined with newlines', async () => {
    const history = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const tool = new ReadReplHistoryTool(() => makeBindings({ getReplHistory: () => history }));
    const result = await tool.call({});
    const lines = result.split('\n');
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe('line 30');
    expect(lines[19]).toBe('line 49');
  });

  it('honours a custom lines count', async () => {
    const history = ['a', 'b', 'c', 'd', 'e'];
    const tool = new ReadReplHistoryTool(() => makeBindings({ getReplHistory: () => history }));
    await expect(tool.call({ lines: 2 })).resolves.toBe('d\ne');
  });

  it('returns the entire history when fewer lines are buffered than requested', async () => {
    const tool = new ReadReplHistoryTool(() =>
      makeBindings({ getReplHistory: () => ['only', 'two'] }),
    );
    await expect(tool.call({ lines: 100 })).resolves.toBe('only\ntwo');
  });

  it('returns an empty string when history is empty', async () => {
    const tool = new ReadReplHistoryTool(() => makeBindings({ getReplHistory: () => [] }));
    await expect(tool.call({})).resolves.toBe('');
  });
});
