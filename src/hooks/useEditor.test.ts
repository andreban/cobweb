// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockDispatch, mockDestroy, mockDocState, capturedListeners } = vi.hoisted(() => {
  const mockDispatch = vi.fn();
  const mockDestroy = vi.fn();
  const mockDocState = { length: 0, content: '' };
  type Update = { docChanged: boolean; state: { doc: { sliceString: () => string } } };
  const capturedListeners: Array<(update: Update) => void> = [];
  return { mockDispatch, mockDestroy, mockDocState, capturedListeners };
});

vi.mock('codemirror', () => {
  type Transaction = {
    changes?: { from: number; to: number; insert: string };
    effects?: unknown;
  };
  function EditorViewMock(this: {
    dispatch: (t: Transaction) => void;
    destroy: typeof mockDestroy;
    state: { doc: { length: number; sliceString: () => string } };
  }) {
    this.dispatch = (transaction: Transaction) => {
      mockDispatch(transaction);
      if (transaction.changes) {
        const previous = mockDocState.content;
        mockDocState.content = transaction.changes.insert;
        mockDocState.length = transaction.changes.insert.length;
        if (previous !== mockDocState.content) {
          capturedListeners.forEach((listener) =>
            listener({
              docChanged: true,
              state: { doc: { sliceString: () => mockDocState.content } },
            }),
          );
        }
      }
    };
    this.destroy = mockDestroy;
    Object.defineProperty(this, 'state', {
      get: () => ({
        doc: {
          get length() {
            return mockDocState.length;
          },
          sliceString: () => mockDocState.content,
        },
      }),
    });
  }
  (EditorViewMock as unknown as { updateListener: { of: (fn: unknown) => unknown } }).updateListener = {
    of: (fn) => {
      capturedListeners.push(fn as (update: never) => void);
      return [];
    },
  };
  (EditorViewMock as unknown as { theme: (spec: unknown) => unknown[] }).theme = () => [];
  return { EditorView: EditorViewMock, basicSetup: [] };
});

vi.mock('@codemirror/state', () => {
  function CompartmentMock(this: { of: () => unknown[]; reconfigure: () => unknown[] }) {
    this.of = () => [];
    this.reconfigure = () => [];
  }
  return {
    EditorState: { create: vi.fn().mockReturnValue({}) },
    Compartment: CompartmentMock,
  };
});

vi.mock('@codemirror/lang-python', () => ({
  python: vi.fn().mockReturnValue([]),
}));

vi.mock('@catppuccin/codemirror', () => ({
  catppuccinLatte: [],
  catppuccinMocha: [],
}));

import { useEditor, type EditorOrigin } from './useEditor';

beforeEach(() => {
  vi.clearAllMocks();
  mockDocState.length = 0;
  mockDocState.content = '';
  capturedListeners.length = 0;
});

function mountedHook() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  let hookResult: ReturnType<typeof useEditor>;
  const rendered = renderHook(() => {
    hookResult = useEditor('dark');
    (hookResult.editorRef as { current: HTMLDivElement | null }).current = div;
    return hookResult;
  });
  return {
    ...rendered,
    get current() {
      return hookResult!;
    },
    cleanup: () => {
      rendered.unmount();
      document.body.removeChild(div);
    },
  };
}

describe('useEditor', () => {
  it('returns editorRef, getContent, and setContent', () => {
    const { result } = renderHook(() => useEditor('dark'));
    expect(result.current.editorRef).toBeDefined();
    expect(typeof result.current.getContent).toBe('function');
    expect(typeof result.current.setContent).toBe('function');
  });

  it('getContent returns empty string when view is not mounted (no DOM node)', () => {
    const { result } = renderHook(() => useEditor('dark'));
    // editorRef.current is null by default — no EditorView is created
    expect(result.current.getContent()).toBe('');
  });

  it('setContent does nothing when view is not mounted', () => {
    const { result } = renderHook(() => useEditor('dark'));
    act(() => result.current.setContent('code'));
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('EditorView is created and destroyed when a DOM node is provided', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    const { unmount } = renderHook(() => {
      const hook = useEditor('dark');
      (hook.editorRef as { current: HTMLDivElement | null }).current = div;
      return hook;
    });

    // EditorView constructor was called
    expect(mockDestroy).not.toHaveBeenCalled();
    unmount();
    expect(mockDestroy).toHaveBeenCalledOnce();

    document.body.removeChild(div);
  });

  it('setContent dispatches a replace-all transaction', () => {
    mockDocState.length = 10;
    const handle = mountedHook();

    act(() => handle.current.setContent('new code'));
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 10, insert: 'new code' },
    });

    handle.cleanup();
  });

  it('getContent returns doc content from the mounted view', () => {
    mockDocState.content = 'print("hello")';
    mockDocState.length = 14;
    const handle = mountedHook();

    expect(handle.current.getContent()).toBe('print("hello")');

    handle.cleanup();
  });
});

describe('useEditor — origin tracking', () => {
  it('starts with untitled origin and isModified false', () => {
    const handle = mountedHook();
    expect(handle.current.origin).toEqual({ kind: 'untitled' });
    expect(handle.current.isModified).toBe(false);
    handle.cleanup();
  });

  it('transitions untitled → local via setOriginAndContent', () => {
    const handle = mountedHook();
    const fileHandle = {} as FileSystemFileHandle;
    const localOrigin: EditorOrigin = { kind: 'local', handle: fileHandle, name: 'main.py' };

    act(() => handle.current.setOriginAndContent(localOrigin, 'print("local")'));

    expect(handle.current.origin).toEqual(localOrigin);
    expect(handle.current.isModified).toBe(false);
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 0, insert: 'print("local")' },
    });
    handle.cleanup();
  });

  it('transitions untitled → device via setOriginAndContent', () => {
    const handle = mountedHook();
    const deviceOrigin: EditorOrigin = { kind: 'device', path: '/main.py' };

    act(() => handle.current.setOriginAndContent(deviceOrigin, 'print("device")'));

    expect(handle.current.origin).toEqual(deviceOrigin);
    expect(handle.current.isModified).toBe(false);
    handle.cleanup();
  });

  it('isModified becomes true when content changes after open', () => {
    const handle = mountedHook();
    const deviceOrigin: EditorOrigin = { kind: 'device', path: '/main.py' };

    act(() => handle.current.setOriginAndContent(deviceOrigin, 'original'));
    expect(handle.current.isModified).toBe(false);

    act(() => handle.current.setContent('edited'));
    expect(handle.current.isModified).toBe(true);

    handle.cleanup();
  });

  it('modify-then-save resets isModified', () => {
    const handle = mountedHook();
    const deviceOrigin: EditorOrigin = { kind: 'device', path: '/main.py' };

    // Open
    act(() => handle.current.setOriginAndContent(deviceOrigin, 'original'));
    expect(handle.current.isModified).toBe(false);

    // Modify
    act(() => handle.current.setContent('edited'));
    expect(handle.current.isModified).toBe(true);

    // Save: caller writes the current content back and re-snapshots via setOriginAndContent.
    act(() => handle.current.setOriginAndContent(deviceOrigin, 'edited'));
    expect(handle.current.isModified).toBe(false);
    expect(handle.current.origin).toEqual(deviceOrigin);

    handle.cleanup();
  });

  it('isModified flips back to false when edits are reverted to the snapshot', () => {
    const handle = mountedHook();
    const deviceOrigin: EditorOrigin = { kind: 'device', path: '/main.py' };

    act(() => handle.current.setOriginAndContent(deviceOrigin, 'snapshot'));
    act(() => handle.current.setContent('changed'));
    expect(handle.current.isModified).toBe(true);

    act(() => handle.current.setContent('snapshot'));
    expect(handle.current.isModified).toBe(false);

    handle.cleanup();
  });
});
