// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ToolRegistry } from '@mast-ai/core';
import type { RunResult } from '../ReplInterface';
import type { DeviceFs } from '../DeviceFs';
import { ReadEditorTool } from './tools/ReadEditorTool';
import { WriteEditorTool } from './tools/WriteEditorTool';
import { RunEditorTool } from './tools/RunEditorTool';
import { RunSnippetTool } from './tools/RunSnippetTool';
import { ReadReplHistoryTool } from './tools/ReadReplHistoryTool';
import { ListDeviceFilesTool } from './tools/ListDeviceFilesTool';
import { ReadDeviceFileTool } from './tools/ReadDeviceFileTool';
import { WriteDeviceFileTool } from './tools/WriteDeviceFileTool';
import { DeleteDeviceFileTool } from './tools/DeleteDeviceFileTool';

export interface ToolBindings {
  getEditorContent(): string;
  setEditorContent(code: string): void;
  runCode(code: string): Promise<RunResult>;
  getReplHistory(): string[];
  onData(handler: (data: Uint8Array) => void): () => void;
  deviceFs: DeviceFs | null;
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
  tools.register(new RunEditorTool(get));
  tools.register(new RunSnippetTool(get));
  tools.register(new ReadReplHistoryTool(get));
  tools.register(new ListDeviceFilesTool(get));
  tools.register(new ReadDeviceFileTool(get));
  tools.register(new WriteDeviceFileTool(get));
  tools.register(new DeleteDeviceFileTool(get));
}
