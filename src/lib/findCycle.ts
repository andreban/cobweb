// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * Diagnostic for `JSON.stringify` failures on circular structures.
 *
 * Mirrors `JSON.stringify`'s walk: only objects on the active recursion stack
 * count as cycles, so legitimate shared (non-circular) references return `null`.
 * Non-plain values (Window, Response, etc.) become cycles only when the host
 * object self-references — which is exactly the Window case behind #167.
 */

export interface CycleHit {
  /** Dot/bracket path from the root, e.g. `entries[0].contentBlocks[2].args.window`. */
  path: string;
  /** `obj.constructor.name` of the re-encountered node, or `'Object'` if unset. */
  constructor: string;
}

export function findCycle(root: unknown): CycleHit | null {
  return walk(root, '', new WeakSet<object>());
}

function walk(value: unknown, path: string, stack: WeakSet<object>): CycleHit | null {
  if (value === null || typeof value !== 'object') return null;
  const obj = value as object;
  if (stack.has(obj)) {
    return { path, constructor: obj.constructor?.name ?? 'Object' };
  }
  stack.add(obj);
  let hit: CycleHit | null = null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length && !hit; i++) {
      hit = walk(obj[i], `${path}[${i}]`, stack);
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (hit) break;
      const childPath = path ? `${path}.${key}` : key;
      hit = walk((obj as Record<string, unknown>)[key], childPath, stack);
    }
  }
  stack.delete(obj);
  return hit;
}
