// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { WriteDeviceFileTool } from './WriteDeviceFileTool';
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

function makeDeviceFs(writeText: (path: string, text: string) => Promise<void>): DeviceFs {
  return { writeText } as unknown as DeviceFs;
}

describe('WriteDeviceFileTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new WriteDeviceFileTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('write_device_file');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('definition makes path and content required', () => {
    const tool = new WriteDeviceFileTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required ?? []).toEqual([
      'path',
      'content',
    ]);
  });

  it('returns a clear message when deviceFs is null', async () => {
    const tool = new WriteDeviceFileTool(() => makeBindings({ deviceFs: null }));
    await expect(tool.call({ path: '/main.py', content: 'x' })).resolves.toBe(
      'Device is not connected.',
    );
  });

  it('forwards path and content to DeviceFs.writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const tool = new WriteDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(writeText) }),
    );
    await tool.call({ path: '/lib/foo.py', content: 'print("hi")\n' });
    expect(writeText).toHaveBeenCalledWith('/lib/foo.py', 'print("hi")\n');
  });

  it('returns "ok" on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const tool = new WriteDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(writeText) }),
    );
    await expect(tool.call({ path: '/main.py', content: 'x = 1' })).resolves.toBe('ok');
  });

  it('does not call DeviceFs.writeText when device is not connected', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const tool = new WriteDeviceFileTool(() => makeBindings({ deviceFs: null }));
    await tool.call({ path: '/main.py', content: 'x' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('propagates DeviceFsError from DeviceFs.writeText', async () => {
    const writeText = vi.fn().mockRejectedValue(new DeviceFsError('ENOSPC: no space left'));
    const tool = new WriteDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(writeText) }),
    );
    await expect(tool.call({ path: '/big.bin', content: 'x' })).rejects.toBeInstanceOf(
      DeviceFsError,
    );
  });

  it('propagates non-device errors from DeviceFs.writeText', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('disconnected'));
    const tool = new WriteDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(writeText) }),
    );
    await expect(tool.call({ path: '/main.py', content: 'x' })).rejects.toThrow('disconnected');
  });
});
