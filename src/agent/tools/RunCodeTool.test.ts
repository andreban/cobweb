// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { RunCodeTool } from './RunCodeTool';
import type { ToolBindings } from '../wireTools';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
    runCode: async () => ({stdout: '', stderr: ''}),
    getReplHistory: () => [],
    onData: () => () => {},
    ...overrides,
  };
}

describe('RunCodeTool', () => {
  it('definition has correct name, scope, and requires approval', () => {
    const tool = new RunCodeTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('run_code');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('returns "(no code to run)" when args.code is empty and editor is empty', async () => {
    const tool = new RunCodeTool(() => makeBindings({ getEditorContent: () => '' }));
    await expect(tool.call({}, {})).resolves.toBe('(no code to run)');
  });

  it('falls back to editor content when code arg is omitted', async () => {
    const runCode = vi.fn().mockResolvedValue({stdout: '42\n', stderr: ''});
    const tool = new RunCodeTool(
      () => makeBindings({ getEditorContent: () => 'print(42)', runCode }),
    );
    await tool.call({}, {});
    expect(runCode).toHaveBeenCalledWith('print(42)');
  });

  it('returns stdout when stderr is empty', async () => {
    const tool = new RunCodeTool(
      () => makeBindings({runCode: async () => ({stdout: 'hello\n', stderr: ''})}),
    );
    await expect(tool.call({code: 'print("hello")'}, {})).resolves.toBe('hello\n');
  });

  it('labels stderr when present alongside stdout', async () => {
    const tool = new RunCodeTool(
      () => makeBindings({runCode: async () => ({stdout: 'partial\n', stderr: 'NameError: x\n'})}),
    );
    await expect(tool.call({code: 'x'}, {})).resolves.toBe('partial\n\nstderr:\nNameError: x\n');
  });

  it('returns stderr only when stdout is empty', async () => {
    const tool = new RunCodeTool(
      () => makeBindings({runCode: async () => ({stdout: '', stderr: 'SyntaxError\n'})}),
    );
    await expect(tool.call({code: ')'}, {})).resolves.toBe('stderr:\nSyntaxError\n');
  });

  it('returns "(no output)" when stdout and stderr are both empty', async () => {
    const tool = new RunCodeTool(
      () => makeBindings({runCode: async () => ({stdout: '', stderr: ''})}),
    );
    await expect(tool.call({code: 'pass'}, {})).resolves.toBe('(no output)');
  });

  it('rejects when the abort signal fires before runCode resolves', async () => {
    const controller = new AbortController();
    let neverResolve!: () => void;
    const tool = new RunCodeTool(
      () =>
        makeBindings({
          runCode: () => new Promise<{stdout: string; stderr: string}>((res) => {
            // Stash so the test can release it after asserting (avoids hanging Vitest).
            neverResolve = () => res({stdout: '', stderr: ''});
          }),
        }),
    );
    const promise = tool.call({code: 'x'}, {signal: controller.signal});
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
    neverResolve();
  });

  it('rejects when runCode rejects', async () => {
    const tool = new RunCodeTool(
      () =>
        makeBindings({
          runCode: async () => {
            throw new Error('serial closed');
          },
        }),
    );
    await expect(tool.call({code: 'x'}, {})).rejects.toThrow('serial closed');
  });
});
