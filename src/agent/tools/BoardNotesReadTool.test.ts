// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import { BoardNotesReadTool } from './BoardNotesReadTool';
import type { ToolBindings, BoardIdentity } from '../wireTools';

function makeBindings(overrides: Partial<ToolBindings> = {}): ToolBindings {
  return {
    getEditorContent: () => '',
    setEditorContent: () => {},
    replaceEditorRange: () => {},
    runCode: async () => ({ stdout: '', stderr: '' }),
    getReplHistory: () => [],
    onData: () => () => {},
    deviceFs: null,
    sendInterrupt: () => {},
    boardIdentity: { status: 'disconnected' },
    ...overrides,
  };
}

const READY: BoardIdentity = { status: 'ready', machineName: 'Pico' };

beforeEach(() => {
  localStorage.clear();
});

describe('BoardNotesReadTool', () => {
  it('definition has correct name, scope, and no approval', () => {
    const tool = new BoardNotesReadTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('read_board_notes');
    expect(def.scope).toBe('read');
    expect(def.requiresApproval).toBe(false);
  });

  it('returns disconnected message when no board is connected', async () => {
    const tool = new BoardNotesReadTool(() =>
      makeBindings({ boardIdentity: { status: 'disconnected' } }),
    );
    await expect(tool.call()).resolves.toBe(
      'No board connected. Notes are scoped per-board; connect a device to read its notes.',
    );
  });

  it('returns probing message while identifying the board', async () => {
    const tool = new BoardNotesReadTool(() =>
      makeBindings({ boardIdentity: { status: 'probing' } }),
    );
    await expect(tool.call()).resolves.toBe(
      'Identifying the connected board… try again in a moment.',
    );
  });

  it('returns "" when ready and no entry exists for the board', async () => {
    const tool = new BoardNotesReadTool(() =>
      makeBindings({ boardIdentity: READY }),
    );
    await expect(tool.call()).resolves.toBe('');
  });

  it('returns the stored entry when ready', async () => {
    localStorage.setItem('cobweb:board-notes:Pico', '# Notes for Pico\n');
    const tool = new BoardNotesReadTool(() =>
      makeBindings({ boardIdentity: READY }),
    );
    await expect(tool.call()).resolves.toBe('# Notes for Pico\n');
  });

  it('does not leak across boards', async () => {
    localStorage.setItem('cobweb:board-notes:Pico', 'pico notes');
    localStorage.setItem('cobweb:board-notes:Esp32', 'esp32 notes');
    const tool = new BoardNotesReadTool(() =>
      makeBindings({ boardIdentity: { status: 'ready', machineName: 'Esp32' } }),
    );
    await expect(tool.call()).resolves.toBe('esp32 notes');
  });
});
