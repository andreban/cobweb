// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { StopProgramTool } from './StopProgramTool';
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

describe('StopProgramTool', () => {
  it('definition has correct name, scope, and approval flag', () => {
    const tool = new StopProgramTool(() => makeBindings());
    const def = tool.definition();
    expect(def.name).toBe('stop_program');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBe(false);
  });

  it('calls sendInterrupt and returns "Interrupt sent."', async () => {
    const sendInterrupt = vi.fn();
    const tool = new StopProgramTool(() => makeBindings({ sendInterrupt }));
    const result = await tool.call();
    expect(sendInterrupt).toHaveBeenCalledOnce();
    expect(result).toBe('Interrupt sent.');
  });

  it('reads bindings lazily via the getter', async () => {
    const sendInterrupt = vi.fn();
    let bindings = makeBindings({ sendInterrupt: () => {} });
    const tool = new StopProgramTool(() => bindings);
    await tool.call();
    expect(sendInterrupt).not.toHaveBeenCalled();

    bindings = makeBindings({ sendInterrupt });
    await tool.call();
    expect(sendInterrupt).toHaveBeenCalledOnce();
  });
});
