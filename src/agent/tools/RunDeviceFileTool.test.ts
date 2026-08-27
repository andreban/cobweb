// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { RunDeviceFileTool } from './RunDeviceFileTool';
import type { ToolBindings } from '../wireTools';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
    getEditorOrigin: () => ({ kind: 'file', path: 'untitled.py' }),
    setOriginAndContent: () => {},
    replaceEditorRange: () => {},
    runCode: async () => ({ stdout: '', stderr: '' }),
    getReplHistory: () => [],
    onData: () => () => {},
    deviceFs: null,
    sendInterrupt: () => {},
    boardIdentity: { status: 'disconnected' },
    ...overrides,
  };
}

describe('RunDeviceFileTool', () => {
  it('definition has correct name, scope, parameters, and requires approval', () => {
    const tool = new RunDeviceFileTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('run_device_file');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
    expect((def.parameters as { required?: string[] }).required).toEqual(['path']);
  });

  it('returns "(path is empty)" when path argument is empty string', async () => {
    const tool = new RunDeviceFileTool(() => makeBindings());
    await expect(tool.call({ path: '   ' }, {})).resolves.toBe('(path is empty)');
  });

  it('formats exec(open(...).read()) and passes to runCode', async () => {
    const runCode = vi.fn().mockResolvedValue({ stdout: 'hello\n', stderr: '' });
    const tool = new RunDeviceFileTool(() => makeBindings({ runCode }));
    await tool.call({ path: 'main.py' }, {});
    expect(runCode).toHaveBeenCalledWith("exec(open('main.py').read())");
  });

  it('escapes quotes in file path', async () => {
    const runCode = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const tool = new RunDeviceFileTool(() => makeBindings({ runCode }));
    await tool.call({ path: "dir/test's.py" }, {});
    expect(runCode).toHaveBeenCalledWith("exec(open('dir/test\\'s.py').read())");
  });

  it('returns short-program output when runCode resolves within startup window', async () => {
    const tool = new RunDeviceFileTool(() =>
      makeBindings({
        runCode: async () => ({ stdout: 'done\n', stderr: '' }),
      }),
    );
    await expect(tool.call({ path: 'test.py' }, {})).resolves.toBe('done\n');
  });

  it('returns started message for long-running program', async () => {
    let release!: () => void;
    const tool = new RunDeviceFileTool(() =>
      makeBindings({
        runCode: () =>
          new Promise((resolve) => {
            release = () => resolve({ stdout: '', stderr: '' });
          }),
      }),
    );
    const result = await tool.call({ path: 'main.py' }, {});
    expect(result).toMatch(/Program main.py started on the device/);
    release();
  });
});
