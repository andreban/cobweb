// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { findCycle } from './findCycle';

describe('findCycle', () => {
  it('returns null for plain serialisable data', () => {
    expect(findCycle({ a: 1, b: 'x', c: [1, 2, { d: true }] })).toBeNull();
  });

  it('returns null for shared but non-circular references', () => {
    const shared = { value: 1 };
    expect(findCycle({ x: shared, y: shared, z: [shared, shared] })).toBeNull();
  });

  it('finds a direct self-reference', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(findCycle(obj)).toEqual({ path: 'self', constructor: 'Object' });
  });

  it('finds a cycle through nested objects and arrays', () => {
    const root: { entries: Array<Record<string, unknown>> } = { entries: [{}] };
    root.entries[0].back = root.entries;
    expect(findCycle(root)).toEqual({ path: 'entries[0].back', constructor: 'Array' });
  });

  it('reports the constructor name of class instances', () => {
    class Widget {
      ref!: Widget;
    }
    const w = new Widget();
    w.ref = w;
    const hit = findCycle({ outer: w });
    expect(hit).toEqual({ path: 'outer.ref', constructor: 'Widget' });
  });

  it('reports a path of "" when the root is its own first cycle target', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { a };
    a.b = b;
    expect(findCycle(a)).toEqual({ path: 'b.a', constructor: 'Object' });
  });

  it('returns null for primitives at the root', () => {
    expect(findCycle(null)).toBeNull();
    expect(findCycle(undefined)).toBeNull();
    expect(findCycle(42)).toBeNull();
    expect(findCycle('hello')).toBeNull();
  });
});
