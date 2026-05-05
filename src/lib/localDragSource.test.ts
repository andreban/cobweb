// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import {
  LOCAL_PATH_MIME,
  clearLocalDragSource,
  consumeLocalDragSource,
  registerLocalDragSource,
} from './localDragSource';

const fakeHandle = {} as FileSystemFileHandle;

describe('localDragSource', () => {
  it('exposes the agreed MIME type', () => {
    expect(LOCAL_PATH_MIME).toBe('application/x-cobweb-local-path');
  });

  it('roundtrips handle and name through register → consume', () => {
    const id = registerLocalDragSource(fakeHandle, 'app.py');
    const value = consumeLocalDragSource(id);
    expect(value).toEqual({ handle: fakeHandle, name: 'app.py' });
  });

  it('returns undefined for unknown ids', () => {
    expect(consumeLocalDragSource('does-not-exist')).toBeUndefined();
  });

  it('consume removes the entry so a second consume sees nothing', () => {
    const id = registerLocalDragSource(fakeHandle, 'a.py');
    expect(consumeLocalDragSource(id)).toBeDefined();
    expect(consumeLocalDragSource(id)).toBeUndefined();
  });

  it('issues distinct ids for distinct registrations', () => {
    const id1 = registerLocalDragSource(fakeHandle, 'a.py');
    const id2 = registerLocalDragSource(fakeHandle, 'b.py');
    expect(id1).not.toBe(id2);
    clearLocalDragSource(id1);
    clearLocalDragSource(id2);
  });

  it('clearLocalDragSource removes the entry', () => {
    const id = registerLocalDragSource(fakeHandle, 'a.py');
    clearLocalDragSource(id);
    expect(consumeLocalDragSource(id)).toBeUndefined();
  });
});
