// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveEditor } from './saveEditor';
import type { EditorOrigin } from '../hooks/useEditor';

interface FakeWritable {
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface FakeFileHandle {
  name: string;
  createWritable: ReturnType<typeof vi.fn>;
  __writable: FakeWritable;
}

function makeFakeHandle(name: string): FakeFileHandle {
  const writable: FakeWritable = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    name,
    createWritable: vi.fn().mockResolvedValue(writable),
    __writable: writable,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saveEditor', () => {
  describe('origin: device', () => {
    it('is a no-op when no writeDevice is provided', async () => {
      const setOriginAndContent = vi.fn();
      const result = await saveEditor(
        { kind: 'device', path: '/main.py' },
        'print("hi")',
        setOriginAndContent
      );
      expect(result).toBe('noop');
      expect(setOriginAndContent).not.toHaveBeenCalled();
    });

    it('writes through writeDevice and re-snapshots', async () => {
      const setOriginAndContent = vi.fn();
      const writeDevice = vi.fn().mockResolvedValue(undefined);
      const origin: EditorOrigin = { kind: 'device', path: '/main.py' };

      const result = await saveEditor(origin, 'print("hi")', setOriginAndContent, writeDevice);

      expect(result).toBe('saved');
      expect(writeDevice).toHaveBeenCalledWith('/main.py', 'print("hi")');
      expect(setOriginAndContent).toHaveBeenCalledWith(origin, 'print("hi")');
    });

    it('does not re-snapshot when writeDevice rejects', async () => {
      const setOriginAndContent = vi.fn();
      const writeDevice = vi.fn().mockRejectedValue(new Error('device offline'));

      await expect(
        saveEditor(
          { kind: 'device', path: '/main.py' },
          'print("hi")',
          setOriginAndContent,
          writeDevice
        )
      ).rejects.toThrow('device offline');

      expect(setOriginAndContent).not.toHaveBeenCalled();
    });
  });

  describe('origin: local', () => {
    it('writes through createWritable() and re-snapshots', async () => {
      const handle = makeFakeHandle('main.py');
      const origin: EditorOrigin = {
        kind: 'local',
        handle: handle as unknown as FileSystemFileHandle,
        name: 'main.py',
      };
      const setOriginAndContent = vi.fn();

      const result = await saveEditor(origin, 'edited', setOriginAndContent);

      expect(result).toBe('saved');
      expect(handle.createWritable).toHaveBeenCalledOnce();
      expect(handle.__writable.write).toHaveBeenCalledWith('edited');
      expect(handle.__writable.close).toHaveBeenCalledOnce();
      expect(setOriginAndContent).toHaveBeenCalledWith(origin, 'edited');
    });

    it('closes the writable even if write fails', async () => {
      const handle = makeFakeHandle('main.py');
      handle.__writable.write.mockRejectedValueOnce(new Error('disk full'));
      const setOriginAndContent = vi.fn();

      await expect(
        saveEditor(
          {
            kind: 'local',
            handle: handle as unknown as FileSystemFileHandle,
            name: 'main.py',
          },
          'edited',
          setOriginAndContent
        )
      ).rejects.toThrow('disk full');

      expect(handle.__writable.close).toHaveBeenCalledOnce();
      expect(setOriginAndContent).not.toHaveBeenCalled();
    });
  });

  describe('origin: untitled', () => {
    let pickerHandle: FakeFileHandle;
    let showSaveFilePicker: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      pickerHandle = makeFakeHandle('chosen.py');
      showSaveFilePicker = vi.fn().mockResolvedValue(pickerHandle);
      vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);
    });

    it('opens the save picker, writes content, and transitions origin to local', async () => {
      const setOriginAndContent = vi.fn();

      const result = await saveEditor({ kind: 'untitled' }, 'print("hello")', setOriginAndContent);

      expect(result).toBe('saved');
      expect(showSaveFilePicker).toHaveBeenCalledOnce();
      const args = showSaveFilePicker.mock.calls[0][0];
      expect(args.suggestedName).toBe('untitled.py');
      expect(args.types[0].accept['text/x-python']).toContain('.py');

      expect(pickerHandle.__writable.write).toHaveBeenCalledWith('print("hello")');
      expect(pickerHandle.__writable.close).toHaveBeenCalledOnce();
      expect(setOriginAndContent).toHaveBeenCalledWith(
        {
          kind: 'local',
          handle: pickerHandle,
          name: 'chosen.py',
        },
        'print("hello")'
      );
    });

    it('returns "cancelled" and does nothing when the user dismisses the picker', async () => {
      showSaveFilePicker.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
      const setOriginAndContent = vi.fn();

      const result = await saveEditor({ kind: 'untitled' }, 'unsaved', setOriginAndContent);

      expect(result).toBe('cancelled');
      expect(setOriginAndContent).not.toHaveBeenCalled();
    });

    it('rethrows non-Abort errors from the picker', async () => {
      showSaveFilePicker.mockRejectedValueOnce(new Error('boom'));
      const setOriginAndContent = vi.fn();

      await expect(
        saveEditor({ kind: 'untitled' }, 'unsaved', setOriginAndContent)
      ).rejects.toThrow('boom');
      expect(setOriginAndContent).not.toHaveBeenCalled();
    });
  });
});
