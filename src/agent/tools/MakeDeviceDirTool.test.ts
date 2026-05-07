// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { MakeDeviceDirTool } from './MakeDeviceDirTool';
import type { ToolBindings } from '../wireTools';
import { DeviceFs, DeviceFsError } from '../../DeviceFs';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
    replaceEditorRange: () => {},
    runCode: async () => ({ stdout: '', stderr: '' }),
    getReplHistory: () => [],
    onData: () => () => {},
    deviceFs: null,
    ...overrides,
  };
}

function makeDeviceFs(mkdir: (path: string) => Promise<void>): DeviceFs {
  return { mkdir } as unknown as DeviceFs;
}

describe('MakeDeviceDirTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new MakeDeviceDirTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('make_device_dir');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('definition makes path required', () => {
    const tool = new MakeDeviceDirTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required ?? []).toEqual(['path']);
  });

  it('returns a clear message when deviceFs is null', async () => {
    const tool = new MakeDeviceDirTool(() => makeBindings({ deviceFs: null }));
    await expect(tool.call({ path: '/lib' })).resolves.toBe('Device is not connected.');
  });

  it('forwards path to DeviceFs.mkdir', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const tool = new MakeDeviceDirTool(() => makeBindings({ deviceFs: makeDeviceFs(mkdir) }));
    await tool.call({ path: '/lib/foo' });
    expect(mkdir).toHaveBeenCalledWith('/lib/foo');
  });

  it('returns "ok" on success', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const tool = new MakeDeviceDirTool(() => makeBindings({ deviceFs: makeDeviceFs(mkdir) }));
    await expect(tool.call({ path: '/lib' })).resolves.toBe('ok');
  });

  it('does not call DeviceFs.mkdir when device is not connected', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const tool = new MakeDeviceDirTool(() => makeBindings({ deviceFs: null }));
    await tool.call({ path: '/lib' });
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('propagates DeviceFsError from DeviceFs.mkdir', async () => {
    const mkdir = vi.fn().mockRejectedValue(new DeviceFsError('EEXIST: directory exists'));
    const tool = new MakeDeviceDirTool(() => makeBindings({ deviceFs: makeDeviceFs(mkdir) }));
    await expect(tool.call({ path: '/lib' })).rejects.toBeInstanceOf(DeviceFsError);
  });

  it('propagates non-device errors from DeviceFs.mkdir', async () => {
    const mkdir = vi.fn().mockRejectedValue(new Error('disconnected'));
    const tool = new MakeDeviceDirTool(() => makeBindings({ deviceFs: makeDeviceFs(mkdir) }));
    await expect(tool.call({ path: '/lib' })).rejects.toThrow('disconnected');
  });
});
