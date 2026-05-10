// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { ToolRegistry } from '@mast-ai/core';
import type { RunResult } from '../ReplInterface';
import type { DeviceFs } from '../DeviceFs';
import { ReadEditorTool } from './tools/ReadEditorTool';
import { WriteEditorTool } from './tools/WriteEditorTool';
import { EditEditorTool } from './tools/EditEditorTool';
import { EditDeviceFileTool } from './tools/EditDeviceFileTool';
import { RunEditorTool } from './tools/RunEditorTool';
import { RunSnippetTool } from './tools/RunSnippetTool';
import { ReadReplHistoryTool } from './tools/ReadReplHistoryTool';
import { ListDeviceFilesTool } from './tools/ListDeviceFilesTool';
import { ReadDeviceFileTool } from './tools/ReadDeviceFileTool';
import { WriteDeviceFileTool } from './tools/WriteDeviceFileTool';
import { DeleteDeviceFileTool } from './tools/DeleteDeviceFileTool';
import { MakeDeviceDirTool } from './tools/MakeDeviceDirTool';
import { StopProgramTool } from './tools/StopProgramTool';
import { GetBoardInfoTool } from './tools/GetBoardInfoTool';
import { OpenDeviceFileInEditorTool } from './tools/OpenDeviceFileInEditorTool';
import { SaveEditorToDeviceTool } from './tools/SaveEditorToDeviceTool';
import { BoardNotesReadTool } from './tools/BoardNotesReadTool';
import { BoardNotesWriteTool } from './tools/BoardNotesWriteTool';
import { BoardNotesEditTool } from './tools/BoardNotesEditTool';
import { FetchUrlTool } from './tools/FetchUrlTool';

export type BoardIdentity =
  | { status: 'disconnected' }
  | { status: 'probing' }
  | { status: 'ready'; machineName: string };

export interface ToolBindings {
  getEditorContent(): string;
  setEditorContent(code: string): void;
  /**
   * Targeted partial edit. Used by `edit_editor` so the user's scroll
   * position is preserved after the edit applies.
   */
  replaceEditorRange(from: number, to: number, replacement: string): void;
  runCode(code: string): Promise<RunResult>;
  getReplHistory(): string[];
  onData(handler: (data: Uint8Array) => void): () => void;
  deviceFs: DeviceFs | null;
  sendInterrupt(): void;
  /**
   * State of the connect-time `os.uname().machine` probe. The notes tools
   * branch on `status` so that "no board connected" (a legitimate workflow
   * — editing local files without a device) and "board connected, still
   * identifying it" (a transient state in the first ~hundred ms after
   * connect) produce distinct messages, rather than collapsing the latter
   * into a misleading "Board not connected".
   */
  boardIdentity: BoardIdentity;
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
  tools.register(new EditEditorTool(get));
  tools.register(new RunEditorTool(get));
  tools.register(new RunSnippetTool(get));
  tools.register(new ReadReplHistoryTool(get));
  tools.register(new ListDeviceFilesTool(get));
  tools.register(new ReadDeviceFileTool(get));
  tools.register(new WriteDeviceFileTool(get));
  tools.register(new EditDeviceFileTool(get));
  tools.register(new DeleteDeviceFileTool(get));
  tools.register(new MakeDeviceDirTool(get));
  tools.register(new StopProgramTool(get));
  tools.register(new GetBoardInfoTool(get));
  tools.register(new OpenDeviceFileInEditorTool(get));
  tools.register(new SaveEditorToDeviceTool(get));
  tools.register(new BoardNotesReadTool(get));
  tools.register(new BoardNotesWriteTool(get));
  tools.register(new BoardNotesEditTool(get));
  tools.register(new FetchUrlTool());
}
