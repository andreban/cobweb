// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import type {
  AgentConfig,
  AgentEvent,
  AgentRunner,
  ApprovalHandler,
  ToolContext,
} from '@mast-ai/core';
import { createDelegateToCoderTool } from './DelegateToCoderTool';
import { CODING_AGENT } from '../config';

interface StubBuilderState {
  parentContext?: ToolContext;
  signal?: AbortSignal;
  runStreamInput?: string;
  approvalHandler?: ApprovalHandler;
}

function makeStubRunner(
  events: AgentEvent[],
  options: { runnerApprovalHandler?: ApprovalHandler } = {},
): {
  runner: AgentRunner;
  state: StubBuilderState;
  runBuilder: ReturnType<typeof vi.fn>;
} {
  const state: StubBuilderState = {};

  const builder = {
    forwardTo(parentContext: ToolContext) {
      state.parentContext = parentContext;
      return this;
    },
    signal(signal: AbortSignal) {
      state.signal = signal;
      return this;
    },
    withApprovalHandler(handler: ApprovalHandler) {
      state.approvalHandler = handler;
      return this;
    },
    async *runStream(input: string): AsyncIterable<AgentEvent> {
      state.runStreamInput = input;
      for (const event of events) {
        if (event.type !== 'done') {
          state.parentContext?.onEvent?.(event);
        }
        yield event;
      }
    },
  };

  const runBuilder = vi.fn((agent: AgentConfig) => {
    void agent;
    return builder;
  });
  const runner = {
    runBuilder,
    approvalHandler: options.runnerApprovalHandler,
  } as unknown as AgentRunner;
  return { runner, state, runBuilder };
}

describe('createDelegateToCoderTool', () => {
  it('definition has the expected name, scope, and parameters', () => {
    const { runner } = makeStubRunner([]);
    const tool = createDelegateToCoderTool(runner);
    const def = tool.definition();

    expect(def.name).toBe('delegate_to_coder');
    expect(def.scope).toBe('write');
    expect(def.requiresApproval).toBeUndefined();
    expect(def.parameters).toMatchObject({
      type: 'object',
      properties: {
        task: { type: 'string' },
      },
      required: ['task'],
    });
  });

  it('passes the task string as input to runStream and runs CODING_AGENT', async () => {
    const events: AgentEvent[] = [
      { type: 'done', output: 'coder finished', history: [] },
    ];
    const { runner, state, runBuilder } = makeStubRunner(events);
    const tool = createDelegateToCoderTool(runner);

    const result = await tool.call({ task: 'foo' }, {});

    expect(runBuilder).toHaveBeenCalledWith(CODING_AGENT);
    expect(state.runStreamInput).toBe('foo');
    expect(result).toBe('coder finished');
  });

  it('forwards sub-agent events (text_delta, tool_call_started) to context.onEvent', async () => {
    const events: AgentEvent[] = [
      { type: 'tool_call_started', name: 'edit_editor', args: { foo: 1 } },
      { type: 'text_delta', delta: 'hello' },
      { type: 'done', output: 'ok', history: [] },
    ];
    const { runner } = makeStubRunner(events);
    const tool = createDelegateToCoderTool(runner);
    const onEvent = vi.fn();

    await tool.call({ task: 'do something' }, { onEvent });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: 'tool_call_started',
      name: 'edit_editor',
      args: { foo: 1 },
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'text_delta',
      delta: 'hello',
    });
  });

  it('forwards the abort signal from context to the builder', async () => {
    const events: AgentEvent[] = [{ type: 'done', output: '', history: [] }];
    const { runner, state } = makeStubRunner(events);
    const tool = createDelegateToCoderTool(runner);
    const controller = new AbortController();

    await tool.call({ task: 't' }, { signal: controller.signal });

    expect(state.signal).toBe(controller.signal);
  });

  it('forwards the parent ApprovalHandler from context to the child builder', async () => {
    const events: AgentEvent[] = [{ type: 'done', output: '', history: [] }];
    const { runner, state } = makeStubRunner(events);
    const tool = createDelegateToCoderTool(runner);
    const approvalHandler: ApprovalHandler = {
      requestApproval: vi.fn(),
    };

    await tool.call({ task: 't' }, { approvalHandler });

    expect(state.approvalHandler).toBe(approvalHandler);
  });

  it('does not override the runner default approvalHandler when one is set', async () => {
    const events: AgentEvent[] = [{ type: 'done', output: '', history: [] }];
    const runnerApprovalHandler: ApprovalHandler = { requestApproval: vi.fn() };
    const { runner, state } = makeStubRunner(events, {
      runnerApprovalHandler,
    });
    const tool = createDelegateToCoderTool(runner);
    const parentApprovalHandler: ApprovalHandler = {
      requestApproval: vi.fn(),
    };

    await tool.call(
      { task: 't' },
      { approvalHandler: parentApprovalHandler },
    );

    expect(state.approvalHandler).toBeUndefined();
  });
});
