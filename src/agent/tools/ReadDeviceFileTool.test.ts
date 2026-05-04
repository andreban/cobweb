// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { ReadDeviceFileTool } from './ReadDeviceFileTool';
import type { ToolBindings } from '../wireTools';
import { DeviceFs, DeviceFsError } from '../../DeviceFs';

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

function makeDeviceFs(readText: (path: string) => Promise<string>): DeviceFs {
  return { readText } as unknown as DeviceFs;
}

describe('ReadDeviceFileTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new ReadDeviceFileTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('read_device_file');
    expect(def.scope).toBe('read');
    expect(def.requiresApproval).toBe(false);
  });

  it('definition makes path required', () => {
    const tool = new ReadDeviceFileTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required ?? []).toEqual(['path']);
  });

  it('returns a clear message when deviceFs is null', async () => {
    const tool = new ReadDeviceFileTool(() => makeBindings({ deviceFs: null }));
    await expect(tool.call({ path: '/main.py' })).resolves.toBe('Device is not connected.');
  });

  it('forwards the requested path to DeviceFs.readText', async () => {
    const readText = vi.fn().mockResolvedValue('print("hi")\n');
    const tool = new ReadDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(readText) }),
    );
    await tool.call({ path: '/lib/foo.py' });
    expect(readText).toHaveBeenCalledWith('/lib/foo.py');
  });

  it('returns the file contents from DeviceFs.readText', async () => {
    const readText = vi.fn().mockResolvedValue('hello world');
    const tool = new ReadDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(readText) }),
    );
    await expect(tool.call({ path: '/note.txt' })).resolves.toBe('hello world');
  });

  it('returns "binary file — cannot read" on UTF-8 decode failure', async () => {
    const decodeErr = new TypeError('The encoded data was not valid for encoding utf-8');
    const wrapped = new Error('File is not valid UTF-8', { cause: decodeErr });
    const readText = vi.fn().mockRejectedValue(wrapped);
    const tool = new ReadDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(readText) }),
    );
    await expect(tool.call({ path: '/blob.bin' })).resolves.toBe('binary file — cannot read');
  });

  it('propagates DeviceFsError (e.g. ENOENT) to the caller', async () => {
    const readText = vi.fn().mockRejectedValue(new DeviceFsError('ENOENT: /nope'));
    const tool = new ReadDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(readText) }),
    );
    await expect(tool.call({ path: '/nope' })).rejects.toBeInstanceOf(DeviceFsError);
  });

  it('propagates non-decode errors from DeviceFs.readText', async () => {
    const readText = vi.fn().mockRejectedValue(new Error('disconnected'));
    const tool = new ReadDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(readText) }),
    );
    await expect(tool.call({ path: '/main.py' })).rejects.toThrow('disconnected');
  });
});
