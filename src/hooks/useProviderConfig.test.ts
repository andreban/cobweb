// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProviderConfig } from './useProviderConfig';

beforeEach(() => {
  localStorage.clear();
});

describe('useProviderConfig', () => {
  it('returns null config on first load with empty localStorage', () => {
    const { result } = renderHook(() => useProviderConfig());
    expect(result.current.config).toBeNull();
  });

  it('reads an existing config from localStorage on mount', () => {
    const stored = { provider: 'google-genai' as const, apiKey: 'key123' };
    localStorage.setItem('cobweb:provider-config', JSON.stringify(stored));
    const { result } = renderHook(() => useProviderConfig());
    expect(result.current.config).toEqual(stored);
  });

  it('save updates config state', () => {
    const { result } = renderHook(() => useProviderConfig());
    const config = { provider: 'google-genai' as const, apiKey: 'new-key' };
    act(() => result.current.save(config));
    expect(result.current.config).toEqual(config);
  });

  it('save persists config to localStorage', () => {
    const { result } = renderHook(() => useProviderConfig());
    const config = { provider: 'urp' as const, endpoint: 'https://example.com' };
    act(() => result.current.save(config));
    expect(JSON.parse(localStorage.getItem('cobweb:provider-config')!)).toEqual(
      config,
    );
  });

  it('clear sets config to null', () => {
    localStorage.setItem(
      'cobweb:provider-config',
      JSON.stringify({ provider: 'google-genai' as const, apiKey: 'k' }),
    );
    const { result } = renderHook(() => useProviderConfig());
    act(() => result.current.clear());
    expect(result.current.config).toBeNull();
  });

  it('clear removes config from localStorage', () => {
    localStorage.setItem(
      'cobweb:provider-config',
      JSON.stringify({ provider: 'google-genai' as const, apiKey: 'k' }),
    );
    const { result } = renderHook(() => useProviderConfig());
    act(() => result.current.clear());
    expect(localStorage.getItem('cobweb:provider-config')).toBeNull();
  });

  it('saved config survives a remount', () => {
    const { result: r1 } = renderHook(() => useProviderConfig());
    const config = { provider: 'google-genai' as const, apiKey: 'persistent' };
    act(() => r1.current.save(config));

    const { result: r2 } = renderHook(() => useProviderConfig());
    expect(r2.current.config).toEqual(config);
  });
});
