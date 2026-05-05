// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { catppuccinLatte, catppuccinMocha } from '@catppuccin/codemirror';

export type EditorOrigin =
  | { kind: 'untitled' }
  | { kind: 'local'; handle: FileSystemFileHandle; name: string }
  | { kind: 'device'; path: string };

const UNTITLED_KEY = 'cobweb:editor:untitled';

function writeUntitled(content: string): void {
  try {
    localStorage.setItem(UNTITLED_KEY, content);
  } catch {
    // QuotaExceededError or similar — silently drop the in-flight save.
  }
}

function clearUntitled(): void {
  try {
    localStorage.removeItem(UNTITLED_KEY);
  } catch {
    // ignore
  }
}

export function useEditor(theme: 'light' | 'dark') {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const snapshotRef = useRef<string>('');
  const originRef = useRef<EditorOrigin>({ kind: 'untitled' });
  const [origin, setOrigin] = useState<EditorOrigin>({ kind: 'untitled' });
  const [isModified, setIsModified] = useState(false);

  const themeExtension = (t: 'light' | 'dark'): Extension =>
    t === 'dark' ? catppuccinMocha : catppuccinLatte;

  useEffect(() => {
    if (!editorRef.current) return;

    const modifiedListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const current = update.state.doc.sliceString(0);
      setIsModified(current !== snapshotRef.current);
      if (originRef.current.kind === 'untitled') {
        writeUntitled(current);
      }
    });

    const fillHeight = EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
    });

    const view = new EditorView({
      state: EditorState.create({
        extensions: [
          basicSetup,
          python(),
          themeCompartment.current.of(themeExtension(theme)),
          fillHeight,
          modifiedListener,
        ],
      }),
      parent: editorRef.current,
    });
    viewRef.current = view;

    const stored = localStorage.getItem(UNTITLED_KEY);
    if (stored !== null && stored !== '') {
      snapshotRef.current = stored;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: stored },
      });
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(themeExtension(theme)),
    });
  }, [theme]);

  const getContent = useCallback((): string => {
    const view = viewRef.current;
    if (!view) return '';
    return view.state.doc.sliceString(0);
  }, []);

  const setContent = useCallback((code: string): void => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
    });
  }, []);

  const setOriginAndContent = useCallback((newOrigin: EditorOrigin, content: string): void => {
    snapshotRef.current = content;
    originRef.current = newOrigin;
    setOrigin(newOrigin);
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
    setIsModified(false);
    if (newOrigin.kind === 'untitled') {
      writeUntitled(content);
    } else {
      clearUntitled();
    }
  }, []);

  return { editorRef, getContent, setContent, origin, setOriginAndContent, isModified };
}
