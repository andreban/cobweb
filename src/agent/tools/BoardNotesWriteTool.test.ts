// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import { BoardNotesWriteTool } from './BoardNotesWriteTool';
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

describe('BoardNotesWriteTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new BoardNotesWriteTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('write_board_notes');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('returns disconnected message and leaves localStorage unchanged', async () => {
    const tool = new BoardNotesWriteTool(() =>
      makeBindings({ boardIdentity: { status: 'disconnected' } }),
    );
    await expect(tool.call({ content: 'x' })).resolves.toBe(
      'No board connected. Notes are scoped per-board.',
    );
    expect(localStorage.length).toBe(0);
  });

  it('returns probing message and leaves localStorage unchanged', async () => {
    const tool = new BoardNotesWriteTool(() =>
      makeBindings({ boardIdentity: { status: 'probing' } }),
    );
    await expect(tool.call({ content: 'x' })).resolves.toBe(
      'Identifying the connected board… try again in a moment.',
    );
    expect(localStorage.length).toBe(0);
  });

  it('writes content to localStorage and reports byte count when ready', async () => {
    const tool = new BoardNotesWriteTool(() =>
      makeBindings({ boardIdentity: READY }),
    );
    const content = '# Pico\nGP25 is the onboard LED.';
    await expect(tool.call({ content })).resolves.toBe(
      `Saved ${content.length} bytes to notes for "Pico".`,
    );
    expect(localStorage.getItem('cobweb:board-notes:Pico')).toBe(content);
  });

  it('overwrites existing notes', async () => {
    localStorage.setItem('cobweb:board-notes:Pico', 'old notes');
    const tool = new BoardNotesWriteTool(() =>
      makeBindings({ boardIdentity: READY }),
    );
    await tool.call({ content: 'new notes' });
    expect(localStorage.getItem('cobweb:board-notes:Pico')).toBe('new notes');
  });
});
