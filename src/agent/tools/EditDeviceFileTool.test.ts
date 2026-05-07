// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { EditDeviceFileTool } from './EditDeviceFileTool';
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

interface DeviceFsStub {
  readBytes?: (path: string) => Promise<Uint8Array>;
  writeText?: (path: string, text: string) => Promise<void>;
}

function makeDeviceFs(stub: DeviceFsStub): DeviceFs {
  return stub as unknown as DeviceFs;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('EditDeviceFileTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new EditDeviceFileTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('edit_device_file');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('definition makes path, old_string, and new_string required', () => {
    const tool = new EditDeviceFileTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required ?? []).toEqual([
      'path',
      'old_string',
      'new_string',
    ]);
  });

  it('returns "Device is not connected." when deviceFs is null', async () => {
    const tool = new EditDeviceFileTool(() => makeBindings({ deviceFs: null }));
    await expect(
      tool.call({ path: '/main.py', old_string: 'a', new_string: 'b' }),
    ).resolves.toBe('Device is not connected.');
  });

  it('returns "Cannot edit binary file." when the file is not valid UTF-8', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readBytes = vi.fn().mockResolvedValue(new Uint8Array([0xff, 0xfe, 0xfd]));
    const tool = new EditDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs({ readBytes, writeText }) }),
    );
    await expect(
      tool.call({ path: '/blob.bin', old_string: 'a', new_string: 'b' }),
    ).resolves.toBe('Cannot edit binary file.');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('returns "old_string not found in file." when the target is absent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readBytes = vi.fn().mockResolvedValue(utf8('x = 1\n'));
    const tool = new EditDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs({ readBytes, writeText }) }),
    );
    await expect(
      tool.call({ path: '/main.py', old_string: 'missing', new_string: 'y' }),
    ).resolves.toBe('old_string not found in file.');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('returns the ambiguous error message when the target appears more than once', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readBytes = vi.fn().mockResolvedValue(utf8('foo\nbar\nfoo\nfoo\n'));
    const tool = new EditDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs({ readBytes, writeText }) }),
    );
    await expect(
      tool.call({ path: '/main.py', old_string: 'foo', new_string: 'baz' }),
    ).resolves.toBe(
      'old_string is ambiguous — appears 3 times. Include more surrounding context.',
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('writes the replaced content on the unique path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readBytes = vi.fn().mockResolvedValue(utf8('a = 1\nb = 2\nc = 3\n'));
    const tool = new EditDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs({ readBytes, writeText }) }),
    );
    await expect(
      tool.call({ path: '/main.py', old_string: 'b = 2', new_string: 'b = 42' }),
    ).resolves.toBe('File updated.');
    expect(readBytes).toHaveBeenCalledWith('/main.py');
    expect(writeText).toHaveBeenCalledWith('/main.py', 'a = 1\nb = 42\nc = 3\n');
  });

  it('handles multi-line replacements', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readBytes = vi.fn().mockResolvedValue(utf8('def f():\n    return 1\n'));
    const tool = new EditDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs({ readBytes, writeText }) }),
    );
    await expect(
      tool.call({
        path: '/lib/x.py',
        old_string: 'def f():\n    return 1',
        new_string: 'def f():\n    return 42',
      }),
    ).resolves.toBe('File updated.');
    expect(writeText).toHaveBeenCalledWith(
      '/lib/x.py',
      'def f():\n    return 42\n',
    );
  });

  it('does not interpret `$&` and friends in new_string', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readBytes = vi.fn().mockResolvedValue(utf8('marker'));
    const tool = new EditDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs({ readBytes, writeText }) }),
    );
    await tool.call({ path: '/p.py', old_string: 'marker', new_string: '$& $1' });
    expect(writeText).toHaveBeenCalledWith('/p.py', '$& $1');
  });

  it('propagates DeviceFsError from readBytes', async () => {
    const readBytes = vi.fn().mockRejectedValue(new DeviceFsError('ENOENT: /nope'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const tool = new EditDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs({ readBytes, writeText }) }),
    );
    await expect(
      tool.call({ path: '/nope', old_string: 'a', new_string: 'b' }),
    ).rejects.toBeInstanceOf(DeviceFsError);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('propagates DeviceFsError from writeText', async () => {
    const readBytes = vi.fn().mockResolvedValue(utf8('hello'));
    const writeText = vi.fn().mockRejectedValue(new DeviceFsError('ENOSPC: full'));
    const tool = new EditDeviceFileTool(() =>
      makeBindings({ deviceFs: makeDeviceFs({ readBytes, writeText }) }),
    );
    await expect(
      tool.call({ path: '/main.py', old_string: 'hello', new_string: 'hi' }),
    ).rejects.toBeInstanceOf(DeviceFsError);
  });
});
