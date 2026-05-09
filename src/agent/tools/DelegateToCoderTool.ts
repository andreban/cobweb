// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { createAgentTool, type AgentRunner, type Tool } from '@mast-ai/core';
import { CODING_AGENT } from '../config';

export function createDelegateToCoderTool(runner: AgentRunner): Tool {
  return createAgentTool(runner, CODING_AGENT, {
    name: 'delegate_to_coder',
    description:
      'Hands a scoped, self-contained task to the coder sub-agent. Use for any work that requires editing the editor, the device filesystem, or running code on the device. The coder starts with no conversation history, so the task string must include all required context (paths, constraints, success criteria).',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Self-contained instruction for the coder. Include relevant file paths, exact constraints, and success criteria.',
        },
      },
      required: ['task'],
    },
    scope: 'write',
    buildInput: (args) => (args as { task: string }).task,
  });
}
