// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { RunEditorTool } from './RunEditorTool';
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

describe('RunEditorTool', () => {
  it('definition has correct name, scope, and requires approval', () => {
    const tool = new RunEditorTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('run_editor');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('returns "(editor is empty)" when the editor has no content', async () => {
    const tool = new RunEditorTool(() => makeBindings({getEditorContent: () => '   \n'}));
    await expect(tool.call({}, {})).resolves.toBe('(editor is empty)');
  });

  it('passes editor content to runCode', async () => {
    const runCode = vi.fn().mockResolvedValue({stdout: '42\n', stderr: ''});
    const tool = new RunEditorTool(
      () => makeBindings({getEditorContent: () => 'print(42)', runCode}),
    );
    await tool.call({}, {});
    expect(runCode).toHaveBeenCalledWith('print(42)');
  });

  it('returns short-program output when runCode resolves within the startup window', async () => {
    const tool = new RunEditorTool(
      () =>
        makeBindings({
          getEditorContent: () => 'print("hi")',
          runCode: async () => ({stdout: 'hi\n', stderr: ''}),
        }),
    );
    await expect(tool.call({}, {})).resolves.toBe('hi\n');
  });

  it('returns "started" message when runCode does not resolve in the startup window', async () => {
    let release!: () => void;
    const tool = new RunEditorTool(
      () =>
        makeBindings({
          getEditorContent: () => 'while True: pass',
          runCode: () =>
            new Promise((resolve) => {
              release = () => resolve({stdout: '', stderr: ''});
            }),
        }),
    );
    const result = await tool.call({}, {});
    expect(result).toMatch(/Program started on the device/);
    release();
  });

  it('surfaces a fast startup error (e.g. not connected) instead of "started"', async () => {
    const tool = new RunEditorTool(
      () =>
        makeBindings({
          getEditorContent: () => 'print(1)',
          runCode: async () => {
            throw new Error('Not connected');
          },
        }),
    );
    await expect(tool.call({}, {})).rejects.toThrow(/Not connected/);
  });

  it('does not surface a late rejection after the startup window has elapsed', async () => {
    let rejectRun!: (err: Error) => void;
    const tool = new RunEditorTool(
      () =>
        makeBindings({
          getEditorContent: () => 'while True: pass',
          runCode: () =>
            new Promise((_, reject) => {
              rejectRun = reject;
            }),
        }),
    );
    const result = await tool.call({}, {});
    expect(result).toMatch(/Program started on the device/);
    // Reject after we've returned. The tool should have attached a noop catch
    // so this does not surface as an unhandled rejection.
    rejectRun(new Error('disconnected mid-run'));
    // Yield to flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('rejects when the abort signal fires before runCode resolves', async () => {
    const controller = new AbortController();
    let neverResolve!: () => void;
    const tool = new RunEditorTool(
      () =>
        makeBindings({
          getEditorContent: () => 'print(1)',
          runCode: () =>
            new Promise((res) => {
              neverResolve = () => res({stdout: '', stderr: ''});
            }),
        }),
    );
    const promise = tool.call({}, {signal: controller.signal});
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
    neverResolve();
  });
});
