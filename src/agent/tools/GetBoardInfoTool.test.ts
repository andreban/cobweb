// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { GetBoardInfoTool } from './GetBoardInfoTool';
import type { ToolBindings } from '../wireTools';

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
    ...overrides,
  };
}

describe('GetBoardInfoTool', () => {
  it('definition has correct name, scope, and no approval required', () => {
    const tool = new GetBoardInfoTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('get_board_info');
    expect(def.scope).toBe('read');
    expect(def.requiresApproval).toBe(false);
  });

  it('returns formatted board info with machine name when both lines are present', async () => {
    const tool = new GetBoardInfoTool(
      () =>
        makeBindings({
          runCode: async () => ({
            stdout: "micropython (1, 26, 0, '') rp2 7633920\nPresto with RP2350\n",
            stderr: '',
          }),
        }),
    );
    const result = await tool.call({}, {});
    expect(result).toBe('Connected board: Presto with RP2350 (micropython 1.26.0, free RAM: ~7455 KB)');
  });

  it('falls back to name+platform when machine line is absent', async () => {
    const tool = new GetBoardInfoTool(
      () =>
        makeBindings({
          runCode: async () => ({
            stdout: "micropython (1, 23, 0, '') rp2 200000\n",
            stderr: '',
          }),
        }),
    );
    const result = await tool.call({}, {});
    expect(result).toBe('Connected board: micropython on rp2 (micropython 1.23.0, free RAM: ~195 KB)');
  });

  it('returns error for malformed stdout', async () => {
    const tool = new GetBoardInfoTool(
      () => makeBindings({ runCode: async () => ({ stdout: 'not valid output\n', stderr: '' }) }),
    );
    const result = await tool.call({}, {});
    expect(result).toBe('Board info unavailable: unexpected probe output.');
  });

  it('returns error for empty stdout', async () => {
    const tool = new GetBoardInfoTool(
      () => makeBindings({ runCode: async () => ({ stdout: '', stderr: '' }) }),
    );
    const result = await tool.call({}, {});
    expect(result).toBe('Board info unavailable: unexpected probe output.');
  });

  it('returns error when stderr is non-empty', async () => {
    const tool = new GetBoardInfoTool(
      () => makeBindings({ runCode: async () => ({ stdout: '', stderr: 'ImportError: no module named gc\n' }) }),
    );
    const result = await tool.call({}, {});
    expect(result).toBe('Board info unavailable: ImportError: no module named gc');
  });

  it('rejects when the abort signal fires before runCode resolves', async () => {
    const controller = new AbortController();
    let neverResolve!: () => void;
    const tool = new GetBoardInfoTool(
      () =>
        makeBindings({
          runCode: () =>
            new Promise((res) => {
              neverResolve = () => res({ stdout: '', stderr: '' });
            }),
        }),
    );
    const promise = tool.call({}, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
    neverResolve();
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns timed-out message after 5 000 ms', async () => {
      let release!: () => void;
      const tool = new GetBoardInfoTool(
        () =>
          makeBindings({
            runCode: () =>
              new Promise((resolve) => {
                release = () => resolve({ stdout: '', stderr: '' });
              }),
          }),
      );
      const promise = tool.call({}, {});
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;
      expect(result).toBe('Board info unavailable: probe timed out.');
      release();
    });
  });
});
