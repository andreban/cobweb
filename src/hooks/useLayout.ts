// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

const STORAGE_KEY = 'cobweb:layout';

export interface PersistedLayout {
  leftOpen: boolean;
  leftSize: number;
  rightOpen: boolean;
  rightSize: number;
  replOpen: boolean;
  replSize: number;
  leftSplitSize: number;
}

const DEFAULTS: PersistedLayout = {
  leftOpen: true,
  leftSize: 20,
  rightOpen: false,
  rightSize: 35,
  replOpen: true,
  replSize: 40,
  leftSplitSize: 50,
};

function clamp(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function readLayout(): PersistedLayout {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULTS;
  }
  if (parsed === null || typeof parsed !== 'object') return DEFAULTS;
  const p = parsed as Partial<Record<keyof PersistedLayout, unknown>>;
  const pickNumber = (key: keyof PersistedLayout, fallback: number): number => {
    const v = p[key];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v) : fallback;
  };
  const pickBool = (key: keyof PersistedLayout, fallback: boolean): boolean => {
    const v = p[key];
    return typeof v === 'boolean' ? v : fallback;
  };
  return {
    leftOpen: pickBool('leftOpen', DEFAULTS.leftOpen),
    leftSize: pickNumber('leftSize', DEFAULTS.leftSize),
    rightOpen: pickBool('rightOpen', DEFAULTS.rightOpen),
    rightSize: pickNumber('rightSize', DEFAULTS.rightSize),
    replOpen: pickBool('replOpen', DEFAULTS.replOpen),
    replSize: pickNumber('replSize', DEFAULTS.replSize),
    leftSplitSize: pickNumber('leftSplitSize', DEFAULTS.leftSplitSize),
  };
}

export interface UseLayoutResult {
  leftOpen: boolean;
  setLeftOpen: Dispatch<SetStateAction<boolean>>;
  leftSize: number;
  setLeftSize: (v: number) => void;
  rightOpen: boolean;
  setRightOpen: Dispatch<SetStateAction<boolean>>;
  rightSize: number;
  setRightSize: (v: number) => void;
  replOpen: boolean;
  setReplOpen: Dispatch<SetStateAction<boolean>>;
  replSize: number;
  setReplSize: (v: number) => void;
  leftSplitSize: number;
  setLeftSplitSize: (v: number) => void;
}

export function useLayout(): UseLayoutResult {
  const [layout, setLayout] = useState<PersistedLayout>(readLayout);

  const setBoolKey = useCallback(
    (key: 'leftOpen' | 'rightOpen' | 'replOpen', value: SetStateAction<boolean>) => {
      setLayout((prev) => {
        const resolved = typeof value === 'function' ? value(prev[key]) : value;
        const next = { ...prev, [key]: resolved };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const setNumberKey = useCallback(
    (key: 'leftSize' | 'rightSize' | 'replSize' | 'leftSplitSize', v: number) => {
      setLayout((prev) => {
        const next = { ...prev, [key]: clamp(v) };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const setLeftOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (v) => setBoolKey('leftOpen', v),
    [setBoolKey],
  );
  const setRightOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (v) => setBoolKey('rightOpen', v),
    [setBoolKey],
  );
  const setReplOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (v) => setBoolKey('replOpen', v),
    [setBoolKey],
  );
  const setLeftSize = useCallback((v: number) => setNumberKey('leftSize', v), [setNumberKey]);
  const setRightSize = useCallback((v: number) => setNumberKey('rightSize', v), [setNumberKey]);
  const setReplSize = useCallback((v: number) => setNumberKey('replSize', v), [setNumberKey]);
  const setLeftSplitSize = useCallback(
    (v: number) => setNumberKey('leftSplitSize', v),
    [setNumberKey],
  );

  return {
    leftOpen: layout.leftOpen,
    setLeftOpen,
    leftSize: layout.leftSize,
    setLeftSize,
    rightOpen: layout.rightOpen,
    setRightOpen,
    rightSize: layout.rightSize,
    setRightSize,
    replOpen: layout.replOpen,
    setReplOpen,
    replSize: layout.replSize,
    setReplSize,
    leftSplitSize: layout.leftSplitSize,
    setLeftSplitSize,
  };
}
