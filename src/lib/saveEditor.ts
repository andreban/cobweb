// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { EditorOrigin } from '../hooks/useEditor';

export type SaveEditorResult = 'saved' | 'cancelled' | 'noop';

export async function saveEditor(
  origin: EditorOrigin,
  content: string,
  setOriginAndContent: (origin: EditorOrigin, content: string) => void
): Promise<SaveEditorResult> {
  if (origin.kind === 'device') {
    return 'noop';
  }

  if (origin.kind === 'local') {
    await writeToHandle(origin.handle, content);
    setOriginAndContent(origin, content);
    return 'saved';
  }

  let handle: FileSystemFileHandle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: 'untitled.py',
      types: [
        {
          description: 'Python source',
          accept: { 'text/x-python': ['.py'] },
        },
      ],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    throw err;
  }

  await writeToHandle(handle, content);
  setOriginAndContent({ kind: 'local', handle, name: handle.name }, content);
  return 'saved';
}

async function writeToHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}
