// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { ToolRegistry } from '@mast-ai/core';

export interface AppModels {
  tools: ToolRegistry;
}

export function createModels(): AppModels {
  return {
    tools: new ToolRegistry(),
  };
}
