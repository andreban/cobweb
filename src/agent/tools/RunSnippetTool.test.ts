// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { RunSnippetTool } from './RunSnippetTool';
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

describe('RunSnippetTool', () => {
  it('definition has correct name, scope, requires approval, and required code arg', () => {
    const tool = new RunSnippetTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('run_snippet');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
    expect(def.parameters.required).toEqual(['code']);
  });

  it('returns "(empty snippet)" when code is whitespace only', async () => {
    const tool = new RunSnippetTool(() => makeBindings());
    await expect(tool.call({code: '   '}, {})).resolves.toBe('(empty snippet)');
  });

  it('passes code to runCode', async () => {
    const runCode = vi.fn().mockResolvedValue({stdout: '7\n', stderr: ''});
    const tool = new RunSnippetTool(() => makeBindings({runCode}));
    await tool.call({code: 'print(3+4)'}, {});
    expect(runCode).toHaveBeenCalledWith('print(3+4)');
  });

  it('returns stdout when stderr is empty', async () => {
    const tool = new RunSnippetTool(
      () => makeBindings({runCode: async () => ({stdout: 'hello\n', stderr: ''})}),
    );
    await expect(tool.call({code: 'print("hello")'}, {})).resolves.toBe('hello\n');
  });

  it('labels stderr when present alongside stdout', async () => {
    const tool = new RunSnippetTool(
      () => makeBindings({runCode: async () => ({stdout: 'partial\n', stderr: 'NameError: x\n'})}),
    );
    await expect(tool.call({code: 'x'}, {})).resolves.toBe('partial\n\nstderr:\nNameError: x\n');
  });

  it('returns stderr only when stdout is empty', async () => {
    const tool = new RunSnippetTool(
      () => makeBindings({runCode: async () => ({stdout: '', stderr: 'SyntaxError\n'})}),
    );
    await expect(tool.call({code: ')'}, {})).resolves.toBe('stderr:\nSyntaxError\n');
  });

  it('returns "(no output)" when stdout and stderr are both empty', async () => {
    const tool = new RunSnippetTool(
      () => makeBindings({runCode: async () => ({stdout: '', stderr: ''})}),
    );
    await expect(tool.call({code: 'pass'}, {})).resolves.toBe('(no output)');
  });

  it('rejects when the abort signal fires before runCode resolves', async () => {
    const controller = new AbortController();
    let neverResolve!: () => void;
    const tool = new RunSnippetTool(
      () =>
        makeBindings({
          runCode: () =>
            new Promise((res) => {
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
    const tool = new RunSnippetTool(
      () =>
        makeBindings({
          runCode: async () => {
            throw new Error('serial closed');
          },
        }),
    );
    await expect(tool.call({code: 'x'}, {})).rejects.toThrow('serial closed');
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns a "still running" message when the wait window elapses', async () => {
      let release!: () => void;
      const tool = new RunSnippetTool(
        () =>
          makeBindings({
            runCode: () =>
              new Promise((resolve) => {
                release = () => resolve({stdout: '', stderr: ''});
              }),
          }),
      );
      const promise = tool.call({code: 'while True: pass'}, {});
      await vi.advanceTimersByTimeAsync(25_000);
      const result = await promise;
      expect(result).toMatch(/still running/);
      release();
    });
  });
});
