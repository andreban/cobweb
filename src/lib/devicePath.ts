// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * Absolute POSIX-style path utilities for the device filesystem.
 *
 * All paths begin with `/`; relative inputs are made absolute by prepending `/`.
 * `.` and `..` segments are resolved during {@link normalise}; `..` cannot escape
 * the root.
 */

const MAX_NAME_BYTES = 255;
// eslint-disable-next-line no-control-regex -- intentionally rejects control characters in names
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const utf8Encoder = new TextEncoder();

export type NameValidation = { ok: true } | { ok: false; reason: string };

/** Resolve `.` and `..` segments and collapse repeated slashes. */
export function normalise(path: string): string {
  const absolute = path.startsWith('/') ? path : '/' + path;
  const stack: string[] = [];
  for (const part of absolute.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return '/' + stack.join('/');
}

/** Join a base path with additional segments and normalise the result. */
export function join(base: string, ...parts: string[]): string {
  return normalise([base, ...parts].join('/'));
}

/** Return the parent directory of a path. The parent of `/` is `/`. */
export function dirname(path: string): string {
  const norm = normalise(path);
  if (norm === '/') return '/';
  const idx = norm.lastIndexOf('/');
  return idx === 0 ? '/' : norm.substring(0, idx);
}

/** Return the final segment of a path. The basename of `/` is the empty string. */
export function basename(path: string): string {
  const norm = normalise(path);
  if (norm === '/') return '';
  return norm.substring(norm.lastIndexOf('/') + 1);
}

/**
 * Validate a single path component (no slashes) for use in create / rename UI.
 * The returned `reason` is a short, user-facing string suitable for inline display.
 */
export function validateName(name: string): NameValidation {
  if (name.trim() === '') {
    return { ok: false, reason: 'Name cannot be empty' };
  }
  if (name.includes('/')) {
    return { ok: false, reason: "Name cannot contain '/'" };
  }
  if (name === '.' || name === '..') {
    return { ok: false, reason: "Name cannot be '.' or '..'" };
  }
  if (CONTROL_CHAR_RE.test(name)) {
    return { ok: false, reason: 'Name cannot contain control characters' };
  }
  if (utf8Encoder.encode(name).length > MAX_NAME_BYTES) {
    return { ok: false, reason: 'Name is too long (max 255 bytes)' };
  }
  return { ok: true };
}
