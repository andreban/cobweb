// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * Coordination map for cross-component drag of local-FS file handles, plus
 * the sibling device-path MIME constant used for device → local drags.
 *
 * `dataTransfer.setData` only accepts strings, so a `FileSystemFileHandle`
 * cannot ride along with the drag payload directly. The drag source registers
 * its handle here under a generated ID and embeds that ID in the payload; the
 * drop target consumes the entry by ID at drop time. HTML5 only supports one
 * drag operation at a time so a single module-scoped Map is safe.
 *
 * Device paths are plain strings, so they ride directly in the drag payload —
 * `DEVICE_PATH_MIME` lives here next to the local one purely for proximity.
 */

export const LOCAL_PATH_MIME = 'application/x-cobweb-local-path';
export const DEVICE_PATH_MIME = 'application/x-cobweb-device-path';

interface LocalDragSource {
  handle: FileSystemFileHandle;
  name: string;
}

const sources = new Map<string, LocalDragSource>();
let counter = 0;

export function registerLocalDragSource(
  handle: FileSystemFileHandle,
  name: string,
): string {
  const id = `local-${++counter}`;
  sources.set(id, { handle, name });
  return id;
}

export function consumeLocalDragSource(id: string): LocalDragSource | undefined {
  const value = sources.get(id);
  sources.delete(id);
  return value;
}

export function clearLocalDragSource(id: string): void {
  sources.delete(id);
}
