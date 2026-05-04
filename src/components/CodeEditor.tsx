// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { RefObject } from 'react';

interface CodeEditorProps {
  editorRef: RefObject<HTMLDivElement>;
}

export function CodeEditor({ editorRef }: CodeEditorProps) {
  return <div ref={editorRef} style={{ width: '100%', height: '100%' }} />;
}
