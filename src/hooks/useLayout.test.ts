// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLayout } from './useLayout';

const KEY = 'cobweb:layout';

describe('useLayout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns documented defaults when nothing is stored', () => {
    const { result } = renderHook(() => useLayout());
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.leftSize).toBe(20);
    expect(result.current.rightOpen).toBe(false);
    expect(result.current.rightSize).toBe(35);
    expect(result.current.replOpen).toBe(true);
    expect(result.current.replSize).toBe(40);
    expect(result.current.leftSplitSize).toBe(50);
  });

  it('restores stored values on mount', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        leftOpen: false,
        leftSize: 12,
        rightOpen: true,
        rightSize: 27,
        replOpen: false,
        replSize: 33,
        leftSplitSize: 66,
      }),
    );
    const { result } = renderHook(() => useLayout());
    expect(result.current.leftOpen).toBe(false);
    expect(result.current.leftSize).toBe(12);
    expect(result.current.rightOpen).toBe(true);
    expect(result.current.rightSize).toBe(27);
    expect(result.current.replOpen).toBe(false);
    expect(result.current.replSize).toBe(33);
    expect(result.current.leftSplitSize).toBe(66);
  });

  it('falls back to defaults when stored JSON is malformed', () => {
    localStorage.setItem(KEY, '{not valid json');
    const { result } = renderHook(() => useLayout());
    expect(result.current.leftSize).toBe(20);
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.rightOpen).toBe(false);
  });

  it('falls back to defaults when stored value is not an object', () => {
    localStorage.setItem(KEY, '"a string"');
    const { result } = renderHook(() => useLayout());
    expect(result.current.leftSize).toBe(20);
    expect(result.current.rightOpen).toBe(false);
  });

  it('falls back to defaults for individual missing or wrongly-typed keys', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ leftSize: 'twenty', rightSize: 25, replOpen: 'yes' }),
    );
    const { result } = renderHook(() => useLayout());
    expect(result.current.leftSize).toBe(20);
    expect(result.current.rightSize).toBe(25);
    expect(result.current.replOpen).toBe(true);
    expect(result.current.rightOpen).toBe(false);
  });

  it('clamps out-of-range numbers on read', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        leftSize: -50,
        rightSize: 250,
        replSize: 40,
        leftSplitSize: 1000,
      }),
    );
    const { result } = renderHook(() => useLayout());
    expect(result.current.leftSize).toBe(0);
    expect(result.current.rightSize).toBe(100);
    expect(result.current.leftSplitSize).toBe(100);
  });

  it('clamps values written through setters', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setLeftSize(-10));
    expect(result.current.leftSize).toBe(0);
    act(() => result.current.setRightSize(150));
    expect(result.current.rightSize).toBe(100);
  });

  it('persists numeric updates to localStorage', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setLeftSize(42));
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(stored.leftSize).toBe(42);
    expect(stored.rightSize).toBe(35);
  });

  it('persists boolean toggles via direct value', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setLeftOpen(false));
    expect(result.current.leftOpen).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').leftOpen).toBe(false);
  });

  it('persists boolean toggles via functional updater', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setReplOpen((o) => !o));
    expect(result.current.replOpen).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').replOpen).toBe(false);
    act(() => result.current.setReplOpen((o) => !o));
    expect(result.current.replOpen).toBe(true);
  });

  it('round-trips a full session: change values, remount, observe restore', () => {
    const first = renderHook(() => useLayout());
    act(() => {
      first.result.current.setLeftSize(15);
      first.result.current.setRightOpen(true);
      first.result.current.setLeftSplitSize(70);
    });
    first.unmount();

    const second = renderHook(() => useLayout());
    expect(second.result.current.leftSize).toBe(15);
    expect(second.result.current.rightOpen).toBe(true);
    expect(second.result.current.leftSplitSize).toBe(70);
  });
});
