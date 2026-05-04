// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme';

function mockMatchMedia(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    mockMatchMedia(false);
  });

  it('defaults to system preference and resolves to light when prefers-color-scheme is light', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.theme).toBe('light');
  });

  it('resolves to dark when system preference is dark', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.theme).toBe('dark');
  });

  it('reads stored preference from localStorage', () => {
    localStorage.setItem('cobweb:theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('dark');
    expect(result.current.theme).toBe('dark');
  });

  it('explicit light preference overrides dark system preference', () => {
    mockMatchMedia(true);
    localStorage.setItem('cobweb:theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('applies dark class to documentElement when resolved theme is dark', () => {
    localStorage.setItem('cobweb:theme', 'dark');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class when resolved theme is light', () => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('cobweb:theme', 'light');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('cycle goes light → dark → system → light and persists each step', () => {
    localStorage.setItem('cobweb:theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('light');

    act(() => result.current.cycle());
    expect(result.current.preference).toBe('dark');
    expect(localStorage.getItem('cobweb:theme')).toBe('dark');

    act(() => result.current.cycle());
    expect(result.current.preference).toBe('system');
    expect(localStorage.getItem('cobweb:theme')).toBe('system');

    act(() => result.current.cycle());
    expect(result.current.preference).toBe('light');
    expect(localStorage.getItem('cobweb:theme')).toBe('light');
  });

  it('setPreference jumps directly to a value', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('dark'));
    expect(result.current.preference).toBe('dark');
    expect(localStorage.getItem('cobweb:theme')).toBe('dark');
  });
});
