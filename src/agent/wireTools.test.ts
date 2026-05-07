// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '@mast-ai/core';
import { wireTools, type ToolBindings } from './wireTools';

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

describe('wireTools', () => {
  it('registers the agent tools on first call', () => {
    const tools = new ToolRegistry();
    wireTools(tools, makeBindings());
    const names = tools.getTools().map((t) => t.name).sort();
    expect(names).toEqual([
      'delete_device_file',
      'edit_device_file',
      'edit_editor',
      'list_device_files',
      'make_device_dir',
      'read_device_file',
      'read_editor',
      'read_repl_history',
      'run_editor',
      'run_snippet',
      'write_device_file',
      'write_editor',
    ]);
  });

  it('does not re-register tools when called again on the same registry', () => {
    const tools = new ToolRegistry();
    wireTools(tools, makeBindings());
    expect(() => wireTools(tools, makeBindings())).not.toThrow();
    expect(tools.getTools()).toHaveLength(12);
  });

  it('updates bindings on subsequent calls so tools see the latest callbacks', async () => {
    const tools = new ToolRegistry();
    const setFirst = vi.fn();
    const setSecond = vi.fn();

    wireTools(tools, makeBindings({ setEditorContent: setFirst }));
    wireTools(tools, makeBindings({ setEditorContent: setSecond }));

    const writer = tools.getTool('write_editor')!;
    await writer.call({ code: 'x' }, {});

    expect(setFirst).not.toHaveBeenCalled();
    expect(setSecond).toHaveBeenCalledWith('x');
  });

  it('isolates bindings per registry', async () => {
    const a = new ToolRegistry();
    const b = new ToolRegistry();
    const setA = vi.fn();
    const setB = vi.fn();
    wireTools(a, makeBindings({ setEditorContent: setA }));
    wireTools(b, makeBindings({ setEditorContent: setB }));

    await a.getTool('write_editor')!.call({ code: 'a' }, {});
    await b.getTool('write_editor')!.call({ code: 'b' }, {});

    expect(setA).toHaveBeenCalledWith('a');
    expect(setB).toHaveBeenCalledWith('b');
  });
});
