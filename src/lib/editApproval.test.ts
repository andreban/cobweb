// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { findUniqueOccurrence, expandToContextLines } from './editApproval';

describe('findUniqueOccurrence', () => {
  it('treats an empty target as missing', () => {
    expect(findUniqueOccurrence('abc', '')).toEqual({ kind: 'missing' });
  });

  it('finds a unique match at the start', () => {
    expect(findUniqueOccurrence('foobar', 'foo')).toEqual({ kind: 'unique', index: 0 });
  });

  it('finds a unique match in the middle', () => {
    expect(findUniqueOccurrence('alpha beta gamma', 'beta')).toEqual({
      kind: 'unique',
      index: 6,
    });
  });

  it('finds a unique match at the end', () => {
    expect(findUniqueOccurrence('hello world', 'world')).toEqual({
      kind: 'unique',
      index: 6,
    });
  });

  it('reports missing when the target is absent', () => {
    expect(findUniqueOccurrence('foo', 'bar')).toEqual({ kind: 'missing' });
  });

  it('reports ambiguous when the target appears more than once', () => {
    const result = findUniqueOccurrence('foo bar foo', 'foo');
    expect(result).toEqual({ kind: 'ambiguous', count: 2 });
  });

  it('counts overlapping candidates with non-overlapping replace semantics', () => {
    // 'aaaa' contains 'aa' at offsets 0 and 2 under non-overlapping scan
    // (the same model as String.prototype.replace).
    const result = findUniqueOccurrence('aaaa', 'aa');
    expect(result).toEqual({ kind: 'ambiguous', count: 2 });
  });

  it('matches across newlines', () => {
    const src = 'line1\nline2\nline3';
    expect(findUniqueOccurrence(src, 'line2\nline3')).toEqual({
      kind: 'unique',
      index: 6,
    });
  });
});

describe('expandToContextLines', () => {
  it('returns 2 lines of context above and below by default', () => {
    const src = ['a', 'b', 'c', 'TARGET', 'd', 'e', 'f'].join('\n');
    const idx = src.indexOf('TARGET');
    const hunk = expandToContextLines(src, idx, 'TARGET', 'X');
    expect(hunk.contextBefore).toEqual(['b', 'c']);
    expect(hunk.before).toEqual(['TARGET']);
    expect(hunk.after).toEqual(['X']);
    expect(hunk.contextAfter).toEqual(['d', 'e']);
    expect(hunk.firstLine).toBe(2); // line 'b' is the 2nd line (1-based)
  });

  it('clips context at the start of the file', () => {
    const src = ['TARGET', 'a', 'b', 'c'].join('\n');
    const hunk = expandToContextLines(src, 0, 'TARGET', 'X');
    expect(hunk.contextBefore).toEqual([]);
    expect(hunk.before).toEqual(['TARGET']);
    expect(hunk.after).toEqual(['X']);
    expect(hunk.contextAfter).toEqual(['a', 'b']);
    expect(hunk.firstLine).toBe(1);
  });

  it('clips context at the end of the file', () => {
    const src = ['a', 'b', 'TARGET'].join('\n');
    const idx = src.indexOf('TARGET');
    const hunk = expandToContextLines(src, idx, 'TARGET', 'X');
    expect(hunk.contextBefore).toEqual(['a', 'b']);
    expect(hunk.before).toEqual(['TARGET']);
    expect(hunk.after).toEqual(['X']);
    expect(hunk.contextAfter).toEqual([]);
  });

  it('expands to whole source lines when the target is mid-line', () => {
    const src = ['x = 1', 'y = 2  # tweak me', 'z = 3'].join('\n');
    const idx = src.indexOf('tweak me');
    const hunk = expandToContextLines(src, idx, 'tweak me', 'updated');
    expect(hunk.before).toEqual(['y = 2  # tweak me']);
    expect(hunk.after).toEqual(['y = 2  # updated']);
  });

  it('handles multi-line replacements', () => {
    const src = ['a', 'b', 'first', 'second', 'c', 'd'].join('\n');
    const idx = src.indexOf('first');
    const hunk = expandToContextLines(src, idx, 'first\nsecond', 'one\ntwo\nthree');
    expect(hunk.before).toEqual(['first', 'second']);
    expect(hunk.after).toEqual(['one', 'two', 'three']);
    expect(hunk.contextBefore).toEqual(['a', 'b']);
    expect(hunk.contextAfter).toEqual(['c', 'd']);
  });

  it('respects a custom contextLines value', () => {
    const src = ['a', 'b', 'c', 'd', 'TARGET', 'e', 'f', 'g'].join('\n');
    const idx = src.indexOf('TARGET');
    const hunk = expandToContextLines(src, idx, 'TARGET', 'X', 1);
    expect(hunk.contextBefore).toEqual(['d']);
    expect(hunk.contextAfter).toEqual(['e']);
  });
});
