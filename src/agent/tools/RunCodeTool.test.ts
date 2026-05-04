// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunCodeTool } from './RunCodeTool';
import type { ToolBindings } from '../wireTools';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
    runCode: async () => {},
    getReplHistory: () => [],
    onData: () => () => {},
    ...overrides,
  };
}

describe('RunCodeTool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
    const runCode = vi.fn().mockResolvedValue(undefined);
    const tool = new RunCodeTool(
      () => makeBindings({ getEditorContent: () => 'print(42)', runCode }),
      { idleMs: 10, maxMs: 100 },
    );
    const promise = tool.call({}, {});
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(runCode).toHaveBeenCalledWith('print(42)');
  });

  it('collects REPL output and resolves after idle period', async () => {
    let dataHandler: ((data: Uint8Array) => void) | null = null;
    const tool = new RunCodeTool(
      () =>
        makeBindings({
          runCode: async () => {},
          onData: (h) => {
            dataHandler = h;
            return () => {
              dataHandler = null;
            };
          },
        }),
      { idleMs: 50, maxMs: 5000 },
    );

    const promise = tool.call({ code: 'print("hi")' }, {});
    // Allow the runCode microtask + onData subscription to settle.
    await Promise.resolve();
    dataHandler!(new TextEncoder().encode('hello\n'));
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe('hello\n');
  });

  it('hits the max timeout when output keeps streaming', async () => {
    let dataHandler: ((data: Uint8Array) => void) | null = null;
    const tool = new RunCodeTool(
      () =>
        makeBindings({
          runCode: async () => {},
          onData: (h) => {
            dataHandler = h;
            return () => {};
          },
        }),
      { idleMs: 1000, maxMs: 200 },
    );

    const promise = tool.call({ code: 'while True: pass' }, {});
    await Promise.resolve();
    dataHandler!(new TextEncoder().encode('a'));
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toBe('a');
  });

  it('rejects when the abort signal fires', async () => {
    const controller = new AbortController();
    const tool = new RunCodeTool(
      () =>
        makeBindings({
          runCode: async () => {},
          onData: () => () => {},
        }),
      { idleMs: 50, maxMs: 5000 },
    );
    const promise = tool.call({ code: 'x' }, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
  });

  it('rejects when runCode throws', async () => {
    const tool = new RunCodeTool(
      () =>
        makeBindings({
          runCode: async () => {
            throw new Error('serial closed');
          },
          onData: () => () => {},
        }),
      { idleMs: 50, maxMs: 5000 },
    );
    await expect(tool.call({ code: 'x' }, {})).rejects.toThrow('serial closed');
  });
});
