// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { catppuccinLatte, catppuccinMocha } from '@catppuccin/codemirror';

export function useEditor(theme: 'light' | 'dark') {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());

  const themeExtension = (t: 'light' | 'dark'): Extension =>
    t === 'dark' ? catppuccinMocha : catppuccinLatte;

  useEffect(() => {
    if (!editorRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        extensions: [basicSetup, python(), themeCompartment.current.of(themeExtension(theme))],
      }),
      parent: editorRef.current,
    });
    viewRef.current = view;

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

  return { editorRef, getContent, setContent };
}
