// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ToolRegistry } from '@mast-ai/core';
import type { RunResult } from '../ReplInterface';
import { ReadEditorTool } from './tools/ReadEditorTool';
import { WriteEditorTool } from './tools/WriteEditorTool';
import { RunCodeTool } from './tools/RunCodeTool';
import { ReadReplHistoryTool } from './tools/ReadReplHistoryTool';

export interface ToolBindings {
  getEditorContent(): string;
  setEditorContent(code: string): void;
  runCode(code: string): Promise<RunResult>;
  getReplHistory(): string[];
  onData(handler: (data: Uint8Array) => void): () => void;
}

const REGISTERED = new WeakSet<ToolRegistry>();
const BINDINGS = new WeakMap<ToolRegistry, ToolBindings>();

export function wireTools(tools: ToolRegistry, bindings: ToolBindings): void {
  BINDINGS.set(tools, bindings);
  if (REGISTERED.has(tools)) return;
  REGISTERED.add(tools);

  const get = () => {
    const b = BINDINGS.get(tools);
    if (!b) throw new Error('Tool registry has no bindings');
    return b;
  };

  tools.register(new ReadEditorTool(get));
  tools.register(new WriteEditorTool(get));
  tools.register(new RunCodeTool(get));
  tools.register(new ReadReplHistoryTool(get));
}
