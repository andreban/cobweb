// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockDispatch, mockDestroy, mockDocState } = vi.hoisted(() => {
  const mockDispatch = vi.fn();
  const mockDestroy = vi.fn();
  const mockDocState = { length: 0, content: '' };
  return { mockDispatch, mockDestroy, mockDocState };
});

vi.mock('codemirror', () => {
  function EditorViewMock(this: {
    dispatch: typeof mockDispatch;
    destroy: typeof mockDestroy;
    state: { doc: { length: number; sliceString: () => string } };
  }) {
    this.dispatch = mockDispatch;
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

import { useEditor } from './useEditor';

beforeEach(() => {
  vi.clearAllMocks();
  mockDocState.length = 0;
  mockDocState.content = '';
});

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
    const div = document.createElement('div');
    document.body.appendChild(div);

    let hookResult: ReturnType<typeof useEditor>;
    const { unmount } = renderHook(() => {
      hookResult = useEditor('dark');
      (hookResult.editorRef as { current: HTMLDivElement | null }).current = div;
      return hookResult;
    });

    act(() => hookResult!.setContent('new code'));
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 10, insert: 'new code' },
    });

    unmount();
    document.body.removeChild(div);
  });

  it('getContent returns doc content from the mounted view', () => {
    mockDocState.content = 'print("hello")';
    mockDocState.length = 14;
    const div = document.createElement('div');
    document.body.appendChild(div);

    let hookResult: ReturnType<typeof useEditor>;
    const { unmount } = renderHook(() => {
      hookResult = useEditor('dark');
      (hookResult.editorRef as { current: HTMLDivElement | null }).current = div;
      return hookResult;
    });

    expect(hookResult!.getContent()).toBe('print("hello")');

    unmount();
    document.body.removeChild(div);
  });
});
