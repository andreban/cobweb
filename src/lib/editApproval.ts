// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export type FindResult =
  | { kind: 'unique'; index: number }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; count: number };

/**
 * Counts non-overlapping occurrences of `target` in `source` using literal
 * substring matching (no regex). Empty `target` is treated as `missing`.
 *
 * Counting matches `String.prototype.replace`'s left-to-right, non-overlapping
 * scan, so `findUniqueOccurrence('aaaa', 'aa')` reports `count: 2`.
 */
export function findUniqueOccurrence(source: string, target: string): FindResult {
  if (target === '') return { kind: 'missing' };

  let count = 0;
  let firstIndex = -1;
  let from = 0;
  while (true) {
    const at = source.indexOf(target, from);
    if (at === -1) break;
    if (firstIndex === -1) firstIndex = at;
    count++;
    if (count > 1) return { kind: 'ambiguous', count: countAll(source, target, at + target.length) };
    from = at + target.length;
  }

  if (count === 0) return { kind: 'missing' };
  return { kind: 'unique', index: firstIndex };
}

function countAll(source: string, target: string, startFrom: number): number {
  let count = 2;
  let from = startFrom;
  while (true) {
    const at = source.indexOf(target, from);
    if (at === -1) break;
    count++;
    from = at + target.length;
  }
  return count;
}

export interface ContextHunk {
  /** 1-based line number of the first rendered line (the topmost context line). */
  firstLine: number;
  /** Lines in the source that were replaced. */
  before: string[];
  /** Replacement lines. */
  after: string[];
  /** Up to `contextLines` source lines preceding the change, clipped at file start. */
  contextBefore: string[];
  /** Up to `contextLines` source lines following the change, clipped at file end. */
  contextAfter: string[];
}

/**
 * Given a substring replacement defined by a 0-based `index` and the
 * `oldString` / `newString` pair, computes the set of lines affected and the
 * surrounding context window. Newlines in either string are tolerated; the
 * helper expands the changed range to the full source lines that contain the
 * replacement so the renderer can show whole lines on either side of the diff.
 *
 * `contextLines` defaults to 2 (matches the SPEC's "2 lines above/below").
 */
export function expandToContextLines(
  source: string,
  index: number,
  oldString: string,
  newString: string,
  contextLines = 2,
): ContextHunk {
  const lines = splitLines(source);
  const startLine = lineNumberAt(source, index); // 0-based
  const endLine = lineNumberAt(source, index + oldString.length); // 0-based, inclusive

  const before = lines.slice(startLine, endLine + 1);
  const replacedSourceSlice = before.join('\n');
  const replacement =
    replacedSourceSlice.slice(0, index - lineStartOffset(source, startLine)) +
    newString +
    replacedSourceSlice.slice(
      index - lineStartOffset(source, startLine) + oldString.length,
    );
  const after = replacement.split('\n');

  const ctxStart = Math.max(0, startLine - contextLines);
  const ctxEnd = Math.min(lines.length - 1, endLine + contextLines);

  return {
    firstLine: ctxStart + 1,
    before,
    after,
    contextBefore: lines.slice(ctxStart, startLine),
    contextAfter: lines.slice(endLine + 1, ctxEnd + 1),
  };
}

function splitLines(source: string): string[] {
  // Preserve a trailing empty line if `source` ends with `\n` — keeping the
  // semantic line count stable matters for line-number display.
  return source.split('\n');
}

function lineNumberAt(source: string, index: number): number {
  // Returns 0-based line number of the character at `index`.
  let line = 0;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

function lineStartOffset(source: string, line: number): number {
  // Returns the byte offset of the start of `line` (0-based).
  if (line === 0) return 0;
  let seen = 0;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      seen++;
      if (seen === line) return i + 1;
    }
  }
  return source.length;
}
