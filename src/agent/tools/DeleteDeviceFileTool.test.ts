// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { DeleteDeviceFileTool } from './DeleteDeviceFileTool';
import type { ToolBindings } from '../wireTools';
import { DeviceFs, DeviceFsError } from '../../DeviceFs';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
    runCode: async () => ({ stdout: '', stderr: '' }),
    getReplHistory: () => [],
    onData: () => () => {},
    deviceFs: null,
    ...overrides,
  };
}

function makeDeviceFs(removeFile: (path: string) => Promise<void>): DeviceFs {
  return { removeFile } as unknown as DeviceFs;
}

describe('DeleteDeviceFileTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new DeleteDeviceFileTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('delete_device_file');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('definition makes path required', () => {
    const tool = new DeleteDeviceFileTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required ?? []).toEqual(['path']);
  });

  it('returns a clear message when deviceFs is null', async () => {
    const tool = new DeleteDeviceFileTool(() => makeBindings({ deviceFs: null }));
    await expect(tool.call({ path: '/main.py' })).resolves.toBe('Device is not connected.');
  });

  it('forwards path to DeviceFs.removeFile', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    const tool = new DeleteDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(removeFile) }),
    );
    await tool.call({ path: '/lib/foo.py' });
    expect(removeFile).toHaveBeenCalledWith('/lib/foo.py');
  });

  it('returns "ok" on success', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    const tool = new DeleteDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(removeFile) }),
    );
    await expect(tool.call({ path: '/main.py' })).resolves.toBe('ok');
  });

  it('does not call DeviceFs.removeFile when device is not connected', async () => {
    const removeFile = vi.fn().mockResolvedValue(undefined);
    const tool = new DeleteDeviceFileTool(() => makeBindings({ deviceFs: null }));
    await tool.call({ path: '/main.py' });
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('propagates DeviceFsError from DeviceFs.removeFile', async () => {
    const removeFile = vi.fn().mockRejectedValue(new DeviceFsError('ENOENT: no such file'));
    const tool = new DeleteDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(removeFile) }),
    );
    await expect(tool.call({ path: '/missing.py' })).rejects.toBeInstanceOf(DeviceFsError);
  });

  it('propagates non-device errors from DeviceFs.removeFile', async () => {
    const removeFile = vi.fn().mockRejectedValue(new Error('disconnected'));
    const tool = new DeleteDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(removeFile) }),
    );
    await expect(tool.call({ path: '/main.py' })).rejects.toThrow('disconnected');
  });
});
