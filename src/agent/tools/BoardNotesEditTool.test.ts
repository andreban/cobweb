// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import { BoardNotesEditTool } from './BoardNotesEditTool';
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

describe('BoardNotesEditTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new BoardNotesEditTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('edit_board_notes');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(true);
  });

  it('short-circuits with disconnected message and leaves localStorage untouched', async () => {
    localStorage.setItem('cobweb:board-notes:Pico', 'foo');
    const tool = new BoardNotesEditTool(() =>
      makeBindings({ boardIdentity: { status: 'disconnected' } }),
    );
    await expect(
      tool.call({ old_string: 'foo', new_string: 'bar' }),
    ).resolves.toBe('No board connected. Notes are scoped per-board.');
    expect(localStorage.getItem('cobweb:board-notes:Pico')).toBe('foo');
  });

  it('short-circuits with probing message and leaves localStorage untouched', async () => {
    localStorage.setItem('cobweb:board-notes:Pico', 'foo');
    const tool = new BoardNotesEditTool(() =>
      makeBindings({ boardIdentity: { status: 'probing' } }),
    );
    await expect(
      tool.call({ old_string: 'foo', new_string: 'bar' }),
    ).resolves.toBe('Identifying the connected board… try again in a moment.');
    expect(localStorage.getItem('cobweb:board-notes:Pico')).toBe('foo');
  });

  it('returns "old_string not found" when target is absent', async () => {
    localStorage.setItem('cobweb:board-notes:Pico', 'hello world');
    const tool = new BoardNotesEditTool(() =>
      makeBindings({ boardIdentity: READY }),
    );
    await expect(
      tool.call({ old_string: 'missing', new_string: 'x' }),
    ).resolves.toBe('old_string not found in current notes.');
    expect(localStorage.getItem('cobweb:board-notes:Pico')).toBe('hello world');
  });

  it('returns "old_string not found" when notes are empty', async () => {
    const tool = new BoardNotesEditTool(() =>
      makeBindings({ boardIdentity: READY }),
    );
    await expect(
      tool.call({ old_string: 'anything', new_string: 'x' }),
    ).resolves.toBe('old_string not found in current notes.');
  });

  it('returns ambiguous error when old_string appears more than once', async () => {
    localStorage.setItem('cobweb:board-notes:Pico', 'foo\nbar\nfoo\nfoo\n');
    const tool = new BoardNotesEditTool(() =>
      makeBindings({ boardIdentity: READY }),
    );
    await expect(
      tool.call({ old_string: 'foo', new_string: 'baz' }),
    ).resolves.toBe(
      'old_string appears 3 times in current notes. Add surrounding context to make it unique.',
    );
    expect(localStorage.getItem('cobweb:board-notes:Pico')).toBe('foo\nbar\nfoo\nfoo\n');
  });

  it('replaces the unique occurrence and updates localStorage', async () => {
    localStorage.setItem('cobweb:board-notes:Pico', 'a = 1\nb = 2\nc = 3\n');
    const tool = new BoardNotesEditTool(() =>
      makeBindings({ boardIdentity: READY }),
    );
    await expect(
      tool.call({ old_string: 'b = 2', new_string: 'b = 42' }),
    ).resolves.toBe('Notes updated for "Pico".');
    expect(localStorage.getItem('cobweb:board-notes:Pico')).toBe(
      'a = 1\nb = 42\nc = 3\n',
    );
  });

  it('handles multi-line replacements', async () => {
    localStorage.setItem(
      'cobweb:board-notes:Pico',
      '## Pins\nGP25: LED\n\n## Modules\nrp2, machine\n',
    );
    const tool = new BoardNotesEditTool(() =>
      makeBindings({ boardIdentity: READY }),
    );
    await expect(
      tool.call({
        old_string: '## Pins\nGP25: LED',
        new_string: '## Pins\nGP25: LED (onboard)',
      }),
    ).resolves.toBe('Notes updated for "Pico".');
    expect(localStorage.getItem('cobweb:board-notes:Pico')).toBe(
      '## Pins\nGP25: LED (onboard)\n\n## Modules\nrp2, machine\n',
    );
  });
});
