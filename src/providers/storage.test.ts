// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadProviderConfig,
  saveProviderConfig,
  clearProviderConfig,
} from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('loadProviderConfig', () => {
  it('returns null when nothing is stored', () => {
    expect(loadProviderConfig()).toBeNull();
  });

  it('returns null when stored value is not valid JSON', () => {
    localStorage.setItem('cobweb:provider-config', 'not-json');
    expect(loadProviderConfig()).toBeNull();
  });
});

describe('saveProviderConfig / loadProviderConfig', () => {
  it('round-trips a google-genai config', () => {
    const config = { provider: 'google-genai' as const, apiKey: 'abc123' };
    saveProviderConfig(config);
    expect(loadProviderConfig()).toEqual(config);
  });

  it('round-trips a google-genai config with optional model', () => {
    const config = {
      provider: 'google-genai' as const,
      apiKey: 'key',
      model: 'gemini-pro',
    };
    saveProviderConfig(config);
    expect(loadProviderConfig()).toEqual(config);
  });

  it('round-trips a urp config', () => {
    const config = {
      provider: 'urp' as const,
      endpoint: 'https://example.com/urp',
    };
    saveProviderConfig(config);
    expect(loadProviderConfig()).toEqual(config);
  });

  it('overwrites a previous config', () => {
    saveProviderConfig({ provider: 'google-genai' as const, apiKey: 'old' });
    const newConfig = {
      provider: 'urp' as const,
      endpoint: 'https://new.example.com',
    };
    saveProviderConfig(newConfig);
    expect(loadProviderConfig()).toEqual(newConfig);
  });
});

describe('clearProviderConfig', () => {
  it('removes the stored config', () => {
    saveProviderConfig({ provider: 'google-genai' as const, apiKey: 'key' });
    clearProviderConfig();
    expect(loadProviderConfig()).toBeNull();
  });

  it('is a no-op when nothing is stored', () => {
    expect(() => clearProviderConfig()).not.toThrow();
  });
});
