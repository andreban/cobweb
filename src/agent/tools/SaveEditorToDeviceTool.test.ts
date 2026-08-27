// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { SaveEditorToDeviceTool } from './SaveEditorToDeviceTool';
import type { ToolBindings } from '../wireTools';
import { DeviceFs, DeviceFsError } from '../../DeviceFs';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
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

function makeDeviceFs(writeText: (path: string, text: string) => Promise<void>): DeviceFs {
  return { writeText } as unknown as DeviceFs;
}

describe('SaveEditorToDeviceTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new SaveEditorToDeviceTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('save_editor_to_device');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('definition makes path required', () => {
    const tool = new SaveEditorToDeviceTool(() => makeBindings());
    const def = tool.definition();
    expect((def.parameters as { required?: string[] }).required ?? []).toEqual(['path']);
  });

  it('returns a clear message when deviceFs is null', async () => {
    const tool = new SaveEditorToDeviceTool(() => makeBindings({ deviceFs: null }));
    await expect(tool.call({ path: '/main.py' })).resolves.toBe('Device is not connected.');
  });

  it('does not call deviceFs.writeText when device is not connected', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const tool = new SaveEditorToDeviceTool(() => makeBindings({ deviceFs: null }));
    await tool.call({ path: '/main.py' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('writes editor content to the given path and updates editor origin and content', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const setOriginAndContent = vi.fn();
    const tool = new SaveEditorToDeviceTool(() =>
      makeBindings({
        deviceFs: makeDeviceFs(writeText),
        getEditorContent: () => 'print("hi")\n',
        setOriginAndContent,
      }),
    );
    await tool.call({ path: '/main.py' });
    expect(writeText).toHaveBeenCalledWith('/main.py', 'print("hi")\n');
    expect(setOriginAndContent).toHaveBeenCalledWith(
      { kind: 'device', path: '/main.py' },
      'print("hi")\n',
    );
  });

  it('returns success message on write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const tool = new SaveEditorToDeviceTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(writeText) }),
    );
    await expect(tool.call({ path: '/lib/foo.py' })).resolves.toBe(
      'Editor saved to /lib/foo.py.',
    );
  });

  it('returns DeviceFsError message (e.g. ENOSPC)', async () => {
    const writeText = vi.fn().mockRejectedValue(new DeviceFsError('ENOSPC: no space left'));
    const tool = new SaveEditorToDeviceTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(writeText) }),
    );
    const result = await tool.call({ path: '/big.py' });
    expect(result).toBe('ENOSPC: no space left');
  });

  it('propagates non-device errors from writeText', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('disconnected'));
    const tool = new SaveEditorToDeviceTool(() =>
      makeBindings({ deviceFs: makeDeviceFs(writeText) }),
    );
    await expect(tool.call({ path: '/main.py' })).rejects.toThrow('disconnected');
  });

  it('reads bindings lazily via the getter', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    let bindings = makeBindings({ deviceFs: null });
    const tool = new SaveEditorToDeviceTool(() => bindings);
    await tool.call({ path: '/main.py' });
    expect(writeText).not.toHaveBeenCalled();

    bindings = makeBindings({ deviceFs: makeDeviceFs(writeText) });
    await tool.call({ path: '/main.py' });
    expect(writeText).toHaveBeenCalledOnce();
  });
});
