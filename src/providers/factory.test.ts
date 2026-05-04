import { describe, it, expect } from 'vitest';
import { createAdapter } from './factory';
import { GoogleGenAIAdapter } from '@mast-ai/google-genai';
import { UrpAdapter } from '@mast-ai/core';

describe('createAdapter', () => {
  it('returns a GoogleGenAIAdapter for google-genai config', () => {
    const adapter = createAdapter({ provider: 'google-genai', apiKey: 'key' });
    expect(adapter).toBeInstanceOf(GoogleGenAIAdapter);
  });

  it('returns a GoogleGenAIAdapter when optional model is supplied', () => {
    const adapter = createAdapter({
      provider: 'google-genai',
      apiKey: 'key',
      model: 'gemini-pro',
    });
    expect(adapter).toBeInstanceOf(GoogleGenAIAdapter);
  });

  it('returns a UrpAdapter for urp config', () => {
    const adapter = createAdapter({
      provider: 'urp',
      endpoint: 'https://example.com/urp',
    });
    expect(adapter).toBeInstanceOf(UrpAdapter);
  });

  it('returned adapter exposes a generate method', () => {
    const adapter = createAdapter({ provider: 'google-genai', apiKey: 'key' });
    expect(typeof adapter.generate).toBe('function');
  });
});
