// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import { UrpAdapter, HttpTransport } from '@mast-ai/core';
import type { LlmAdapter } from '@mast-ai/core';
import type { ProviderConfig } from './types';

export function createAdapter(config: ProviderConfig): LlmAdapter {
  switch (config.provider) {
    case 'google-genai':
      return new GoogleGenAIAdapter(config.apiKey, config.model);
    case 'urp':
      return new UrpAdapter(new HttpTransport({ url: config.endpoint }));
  }
}
