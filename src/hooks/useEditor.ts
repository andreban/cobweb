// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Extension,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import { catppuccinLatte, catppuccinMocha } from '@catppuccin/codemirror';

const REVEAL_HIGHLIGHT_MS = 1700;

const setRevealHighlight = StateEffect.define<{ from: number; to: number } | null>();

const revealHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setRevealHighlight)) {
        deco =
          e.value === null
            ? Decoration.none
            : Decoration.set([
                Decoration.mark({ class: 'cobweb-reveal-highlight' }).range(
                  e.value.from,
                  e.value.to,
                ),
              ]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

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
          revealHighlightField,
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

  // Targeted partial edit. Unlike setContent's full-document replacement,
  // CodeMirror keeps the viewport stable across small dispatches — so the
  // user's scroll position is preserved when the agent applies an edit.
  const replaceRange = useCallback(
    (from: number, to: number, replacement: string): void => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from, to, insert: replacement },
      });
    },
    [],
  );

  const revealRange = useCallback((from: number, to: number): void => {
    const view = viewRef.current;
    if (!view) return;
    const docLen = view.state.doc.length;
    const safeFrom = Math.max(0, Math.min(from, docLen));
    const safeTo = Math.max(safeFrom, Math.min(to, docLen));
    view.dispatch({
      effects: [
        EditorView.scrollIntoView(EditorSelection.range(safeFrom, safeTo), { y: 'center' }),
        setRevealHighlight.of({ from: safeFrom, to: safeTo }),
      ],
    });
    setTimeout(() => {
      const v = viewRef.current;
      if (!v) return;
      v.dispatch({ effects: setRevealHighlight.of(null) });
    }, REVEAL_HIGHLIGHT_MS);
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

  return {
    editorRef,
    getContent,
    setContent,
    replaceRange,
    revealRange,
    origin,
    setOriginAndContent,
    isModified,
  };
}
