// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { basename, dirname, escapePythonStr, join, normalise, validateName } from './devicePath';

describe('normalise', () => {
  it('preserves a simple absolute path', () => {
    expect(normalise('/foo/bar')).toBe('/foo/bar');
  });

  it('returns root unchanged', () => {
    expect(normalise('/')).toBe('/');
  });

  it('collapses repeated slashes', () => {
    expect(normalise('//foo///bar//')).toBe('/foo/bar');
  });

  it('strips trailing slash', () => {
    expect(normalise('/foo/bar/')).toBe('/foo/bar');
  });

  it('resolves `.` segments', () => {
    expect(normalise('/foo/./bar')).toBe('/foo/bar');
  });

  it('resolves `..` segments', () => {
    expect(normalise('/foo/bar/../baz')).toBe('/foo/baz');
  });

  it('clamps `..` at the root', () => {
    expect(normalise('/../..')).toBe('/');
    expect(normalise('/../foo')).toBe('/foo');
  });

  it('treats relative input as absolute', () => {
    expect(normalise('foo/bar')).toBe('/foo/bar');
  });

  it('returns root for the empty string', () => {
    expect(normalise('')).toBe('/');
  });
});

describe('join', () => {
  it('joins root with a name', () => {
    expect(join('/', 'foo')).toBe('/foo');
  });

  it('joins multiple segments', () => {
    expect(join('/foo', 'bar', 'baz')).toBe('/foo/bar/baz');
  });

  it('handles trailing slashes in base', () => {
    expect(join('/foo/', 'bar')).toBe('/foo/bar');
  });

  it('normalises `..` while joining', () => {
    expect(join('/foo/bar', '..', 'baz')).toBe('/foo/baz');
  });

  it('normalises embedded slashes in parts', () => {
    expect(join('/foo', '/bar/', '/baz')).toBe('/foo/bar/baz');
  });

  it('returns root when no parts are given', () => {
    expect(join('/')).toBe('/');
  });
});

describe('dirname', () => {
  it('returns root for root', () => {
    expect(dirname('/')).toBe('/');
  });

  it('returns root for a top-level entry', () => {
    expect(dirname('/foo')).toBe('/');
  });

  it('returns the parent directory', () => {
    expect(dirname('/foo/bar')).toBe('/foo');
  });

  it('strips trailing slashes before resolving', () => {
    expect(dirname('/foo/bar/')).toBe('/foo');
  });

  it('handles deeply nested paths', () => {
    expect(dirname('/a/b/c/d')).toBe('/a/b/c');
  });
});

describe('basename', () => {
  it('returns empty string for root', () => {
    expect(basename('/')).toBe('');
  });

  it('returns the final segment', () => {
    expect(basename('/foo/bar')).toBe('bar');
  });

  it('strips trailing slashes', () => {
    expect(basename('/foo/bar/')).toBe('bar');
  });

  it('returns top-level entry', () => {
    expect(basename('/foo')).toBe('foo');
  });
});

describe('escapePythonStr', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(escapePythonStr('/foo/bar.py')).toBe('/foo/bar.py');
  });

  it('escapes backslashes', () => {
    expect(escapePythonStr('a\\b')).toBe('a\\\\b');
  });

  it('escapes single quotes', () => {
    expect(escapePythonStr("a'b")).toBe("a\\'b");
  });

  it('escapes both in the same string', () => {
    expect(escapePythonStr("a\\b'c")).toBe("a\\\\b\\'c");
  });

  it('does not escape double quotes', () => {
    expect(escapePythonStr('a"b')).toBe('a"b');
  });
});

describe('validateName', () => {
  it('accepts a normal filename', () => {
    expect(validateName('main.py')).toEqual({ ok: true });
  });

  it('accepts a unicode name', () => {
    expect(validateName('café.txt')).toEqual({ ok: true });
  });

  it('accepts dot-prefixed names', () => {
    expect(validateName('.gitignore')).toEqual({ ok: true });
    expect(validateName('..foo')).toEqual({ ok: true });
  });

  it('rejects empty string', () => {
    const r = validateName('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/i);
  });

  it('rejects whitespace-only', () => {
    const r = validateName('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/i);
  });

  it('rejects names containing a slash', () => {
    const r = validateName('foo/bar');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("/");
  });

  it('rejects "."', () => {
    const r = validateName('.');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/'\.' or '\.\.'/);
  });

  it('rejects ".."', () => {
    const r = validateName('..');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/'\.' or '\.\.'/);
  });

  it('rejects null bytes', () => {
    const r = validateName('foo\x00bar');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/control/i);
  });

  it('rejects newlines', () => {
    const r = validateName('foo\nbar');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/control/i);
  });

  it('rejects DEL (0x7f)', () => {
    const r = validateName('foo\x7fbar');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/control/i);
  });

  it('accepts a 255-byte ASCII name', () => {
    expect(validateName('a'.repeat(255))).toEqual({ ok: true });
  });

  it('rejects a 256-byte ASCII name', () => {
    const r = validateName('a'.repeat(256));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/long/i);
  });

  it('counts UTF-8 bytes, not characters, for the length limit', () => {
    // '€' is 3 UTF-8 bytes, so 86 of them is 258 bytes (> 255) although only 86 chars.
    const r = validateName('€'.repeat(86));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/long/i);
  });

  it('accepts a name right at the UTF-8 byte boundary', () => {
    // 85 × 3 = 255 bytes — boundary inclusive.
    expect(validateName('€'.repeat(85))).toEqual({ ok: true });
  });
});
