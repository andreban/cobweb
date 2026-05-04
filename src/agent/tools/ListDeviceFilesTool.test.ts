// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { ListDeviceFilesTool } from './ListDeviceFilesTool';
import type { ToolBindings } from '../wireTools';
import type { DeviceFs, DeviceDirEntry } from '../../DeviceFs';

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

function makeDeviceFs(list: (path: string) => Promise<DeviceDirEntry[]>): DeviceFs {
  return { list } as unknown as DeviceFs;
}

describe('ListDeviceFilesTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new ListDeviceFilesTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('list_device_files');
    expect(def.scope).toBe('read');
    expect(def.requiresApproval).toBe(false);
  });

  it('definition makes path optional', () => {
    const tool = new ListDeviceFilesTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required ?? []).toEqual([]);
  });

  it('returns a clear message when deviceFs is null', async () => {
    const tool = new ListDeviceFilesTool(() => makeBindings({ deviceFs: null }));
    await expect(tool.call({})).resolves.toBe('Device is not connected.');
  });

  it('defaults path to "/" when args omit it', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const tool = new ListDeviceFilesTool(() => makeBindings({ deviceFs: makeDeviceFs(list) }));
    await tool.call({});
    expect(list).toHaveBeenCalledWith('/');
  });

  it('forwards the requested path to DeviceFs.list', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const tool = new ListDeviceFilesTool(() => makeBindings({ deviceFs: makeDeviceFs(list) }));
    await tool.call({ path: '/lib' });
    expect(list).toHaveBeenCalledWith('/lib');
  });

  it('joins entries with newlines and suffixes directories with "/"', async () => {
    const list = vi.fn().mockResolvedValue([
      { name: 'lib', isDir: true },
      { name: 'main.py', isDir: false },
      { name: 'boot.py', isDir: false },
    ] satisfies DeviceDirEntry[]);
    const tool = new ListDeviceFilesTool(() => makeBindings({ deviceFs: makeDeviceFs(list) }));
    await expect(tool.call({ path: '/' })).resolves.toBe('lib/\nmain.py\nboot.py');
  });

  it('returns "(empty directory)" for empty listings', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const tool = new ListDeviceFilesTool(() => makeBindings({ deviceFs: makeDeviceFs(list) }));
    await expect(tool.call({ path: '/empty' })).resolves.toBe('(empty directory)');
  });

  it('propagates errors from DeviceFs.list', async () => {
    const list = vi.fn().mockRejectedValue(new Error('ENOENT: /nope'));
    const tool = new ListDeviceFilesTool(() => makeBindings({ deviceFs: makeDeviceFs(list) }));
    await expect(tool.call({ path: '/nope' })).rejects.toThrow('ENOENT: /nope');
  });
});
