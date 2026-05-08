// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { OpenDeviceFileInEditorTool } from './OpenDeviceFileInEditorTool';
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
    sendInterrupt: () => {},
    ...overrides,
  };
}

function makeDeviceFs(readBytes: (path: string) => Promise<Uint8Array>): DeviceFs {
  return { readBytes } as unknown as DeviceFs;
}

const encoder = new TextEncoder();

describe('OpenDeviceFileInEditorTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new OpenDeviceFileInEditorTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('open_device_file_in_editor');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('definition makes path required', () => {
    const tool = new OpenDeviceFileInEditorTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required ?? []).toEqual(['path']);
  });

  it('returns a clear message when deviceFs is null', async () => {
    const tool = new OpenDeviceFileInEditorTool(() => makeBindings({ deviceFs: null }));
    await expect(tool.call({ path: '/main.py' })).resolves.toBe('Device is not connected.');
  });

  it('does not call setEditorContent when device is not connected', async () => {
    const setEditorContent = vi.fn();
    const tool = new OpenDeviceFileInEditorTool(() =>
      makeBindings({ deviceFs: null, setEditorContent }),
    );
    await tool.call({ path: '/main.py' });
    expect(setEditorContent).not.toHaveBeenCalled();
  });

  it('reads file, loads into editor, returns success message', async () => {
    const code = 'print("hello")\n';
    const readBytes = vi.fn().mockResolvedValue(encoder.encode(code));
    const setEditorContent = vi.fn();
    const tool = new OpenDeviceFileInEditorTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(readBytes), setEditorContent }),
    );
    const result = await tool.call({ path: '/main.py' });
    expect(readBytes).toHaveBeenCalledWith('/main.py');
    expect(setEditorContent).toHaveBeenCalledWith(code);
    expect(result).toBe('Editor opened /main.py.');
  });

  it('returns binary error message for non-UTF-8 files', async () => {
    const binaryBytes = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
    const readBytes = vi.fn().mockResolvedValue(binaryBytes);
    const setEditorContent = vi.fn();
    const tool = new OpenDeviceFileInEditorTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(readBytes), setEditorContent }),
    );
    const result = await tool.call({ path: '/blob.bin' });
    expect(result).toBe('Cannot open binary file in editor.');
    expect(setEditorContent).not.toHaveBeenCalled();
  });

  it('returns DeviceFsError message (e.g. ENOENT)', async () => {
    const readBytes = vi.fn().mockRejectedValue(new DeviceFsError('ENOENT: /nope'));
    const tool = new OpenDeviceFileInEditorTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(readBytes) }),
    );
    const result = await tool.call({ path: '/nope' });
    expect(result).toBe('ENOENT: /nope');
  });

  it('propagates non-device errors from readBytes', async () => {
    const readBytes = vi.fn().mockRejectedValue(new Error('disconnected'));
    const tool = new OpenDeviceFileInEditorTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(readBytes) }),
    );
    await expect(tool.call({ path: '/main.py' })).rejects.toThrow('disconnected');
  });

  it('reads bindings lazily via the getter', async () => {
    const code = 'x = 1';
    const readBytes = vi.fn().mockResolvedValue(encoder.encode(code));
    const setEditorContent = vi.fn();
    let bindings = makeBindings({ deviceFs: null });
    const tool = new OpenDeviceFileInEditorTool(() => bindings);
    await tool.call({ path: '/main.py' });
    expect(setEditorContent).not.toHaveBeenCalled();

    bindings = makeBindings({ deviceFs: makeDeviceFs(readBytes), setEditorContent });
    await tool.call({ path: '/main.py' });
    expect(setEditorContent).toHaveBeenCalledWith(code);
  });
});
