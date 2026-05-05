// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceFs, type DeviceDirEntry, type DeviceFsError } from '../DeviceFs';
import { dirname, join } from '../lib/devicePath';
import type { RunResult } from '../ReplInterface';
import type { ConnectionState } from './useReplConnection';

/** Directory node in the device tree; children load lazily on `expand`. */
export interface DeviceTreeNode {
  path: string;
  name: string;
  isDir: true;
  expanded: boolean;
  children: DeviceTreeEntry[];
}

/** File leaf in the device tree. */
export interface DeviceTreeFile {
  path: string;
  name: string;
  isDir: false;
}

export type DeviceTreeEntry = DeviceTreeNode | DeviceTreeFile;

export interface RemoveDirOptions {
  recursive?: boolean;
}

interface ReplConnection {
  connectionState: ConnectionState;
  sendRaw: (code: string) => Promise<RunResult>;
}

/**
 * ViewModel layer over `DeviceFs`. Owns the device tree state, lazy expansion,
 * mutation-driven refresh, and busy/error reporting.
 *
 * Lifecycle: builds a `DeviceFs` and auto-expands `/` when the connection
 * becomes available; discards both on disconnect.
 */
export function useDeviceFs(connection: ReplConnection) {
  const { connectionState, sendRaw } = connection;
  const isAvailable = connectionState === 'connected';

  const [tree, setTree] = useState<DeviceTreeNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<DeviceFsError | Error | null>(null);

  const deviceFsRef = useRef<DeviceFs | null>(null);
  const treeRef = useRef<DeviceTreeNode | null>(null);
  const busyCountRef = useRef(0);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const trackBusy = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    busyCountRef.current++;
    setBusy(true);
    try {
      return await fn();
    } finally {
      busyCountRef.current--;
      if (busyCountRef.current === 0) setBusy(false);
    }
  }, []);

  const runPrimary = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      const result = await fn();
      setLastError(null);
      return result;
    } catch (err) {
      setLastError(toError(err));
      throw err;
    }
  }, []);

  const runBestEffort = useCallback(async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      setLastError(toError(err));
    }
  }, []);

  // List `path` and merge into the tree, preserving the expansion state of
  // surviving subtrees. Used by both `expand` and `refresh`.
  const refreshInternal = useCallback(async (path: string): Promise<void> => {
    const fs = deviceFsRef.current;
    if (!fs) return;
    const entries = await fs.list(path);
    const newEntries = entriesToTree(path, entries);
    setTree((current) => {
      if (!current) return current;
      return updateNode(current, path, (node) => ({
        ...node,
        expanded: true,
        children: mergeChildren(node.children, newEntries),
      }));
    });
  }, []);

  const refreshAfterMutation = useCallback(
    async (path: string): Promise<void> => {
      if (!isExpanded(treeRef.current, path)) return;
      await runBestEffort(() => refreshInternal(path));
    },
    [runBestEffort, refreshInternal],
  );

  const expand = useCallback(
    async (path: string): Promise<void> => {
      if (!deviceFsRef.current) return;
      await trackBusy(() => runPrimary(() => refreshInternal(path)));
    },
    [trackBusy, runPrimary, refreshInternal],
  );

  const collapse = useCallback((path: string): void => {
    setTree((current) =>
      current ? updateNode(current, path, (n) => ({ ...n, expanded: false })) : current,
    );
  }, []);

  const refresh = useCallback(
    async (path: string): Promise<void> => {
      if (!deviceFsRef.current) return;
      await trackBusy(() => runPrimary(() => refreshInternal(path)));
    },
    [trackBusy, runPrimary, refreshInternal],
  );

  const refreshAll = useCallback(async (): Promise<void> => {
    if (!deviceFsRef.current) return;
    const paths = collectExpandedPaths(treeRef.current);
    await trackBusy(async () => {
      for (const p of paths) {
        await runBestEffort(() => refreshInternal(p));
      }
    });
  }, [trackBusy, runBestEffort, refreshInternal]);

  const ensureFs = (): DeviceFs => {
    const fs = deviceFsRef.current;
    if (!fs) throw new Error('Device is not connected');
    return fs;
  };

  const readBytes = useCallback(
    async (path: string): Promise<Uint8Array> => {
      const fs = ensureFs();
      return trackBusy(() => runPrimary(() => fs.readBytes(path)));
    },
    [trackBusy, runPrimary],
  );

  const readText = useCallback(
    async (path: string): Promise<string> => {
      const fs = ensureFs();
      return trackBusy(() => runPrimary(() => fs.readText(path)));
    },
    [trackBusy, runPrimary],
  );

  const writeBytes = useCallback(
    async (path: string, bytes: Uint8Array): Promise<void> => {
      const fs = ensureFs();
      await trackBusy(async () => {
        await runPrimary(() => fs.writeBytes(path, bytes));
        await refreshAfterMutation(dirname(path));
      });
    },
    [trackBusy, runPrimary, refreshAfterMutation],
  );

  const writeText = useCallback(
    async (path: string, text: string): Promise<void> => {
      const fs = ensureFs();
      await trackBusy(async () => {
        await runPrimary(() => fs.writeText(path, text));
        await refreshAfterMutation(dirname(path));
      });
    },
    [trackBusy, runPrimary, refreshAfterMutation],
  );

  const mkdir = useCallback(
    async (path: string): Promise<void> => {
      const fs = ensureFs();
      await trackBusy(async () => {
        await runPrimary(() => fs.mkdir(path));
        await refreshAfterMutation(dirname(path));
      });
    },
    [trackBusy, runPrimary, refreshAfterMutation],
  );

  const rename = useCallback(
    async (from: string, to: string): Promise<void> => {
      const fs = ensureFs();
      await trackBusy(async () => {
        await runPrimary(() => fs.rename(from, to));
        const fromDir = dirname(from);
        const toDir = dirname(to);
        await refreshAfterMutation(fromDir);
        if (toDir !== fromDir) {
          await refreshAfterMutation(toDir);
        }
      });
    },
    [trackBusy, runPrimary, refreshAfterMutation],
  );

  const removeFile = useCallback(
    async (path: string): Promise<void> => {
      const fs = ensureFs();
      await trackBusy(async () => {
        await runPrimary(() => fs.removeFile(path));
        await refreshAfterMutation(dirname(path));
      });
    },
    [trackBusy, runPrimary, refreshAfterMutation],
  );

  const removeDir = useCallback(
    async (path: string, opts: RemoveDirOptions = {}): Promise<void> => {
      const fs = ensureFs();
      await trackBusy(async () => {
        await runPrimary(async () => {
          if (opts.recursive) {
            await removeDirRecursive(fs, path);
          } else {
            await fs.removeDir(path);
          }
        });
        await refreshAfterMutation(dirname(path));
      });
    },
    [trackBusy, runPrimary, refreshAfterMutation],
  );

  // Build / discard the DeviceFs and tree as the connection comes and goes.
  // Auto-expands `/` once the connection is up. Tree state changes happen
  // inside the async IIFE to keep the synchronous effect body free of
  // setState calls.
  useEffect(() => {
    if (isAvailable) {
      deviceFsRef.current = new DeviceFs(sendRaw);
    } else {
      deviceFsRef.current = null;
    }
    void (async () => {
      if (isAvailable) {
        setTree({ path: '/', name: '/', isDir: true, expanded: false, children: [] });
        try {
          await trackBusy(() => runPrimary(() => refreshInternal('/')));
        } catch {
          // Already captured in lastError by runPrimary.
        }
      } else {
        setTree(null);
      }
    })();
  }, [isAvailable, sendRaw, trackBusy, runPrimary, refreshInternal]);

  return {
    isAvailable,
    tree,
    expand,
    collapse,
    refresh,
    refreshAll,
    readText,
    writeText,
    writeBytes,
    readBytes,
    mkdir,
    rename,
    removeFile,
    removeDir,
    busy,
    lastError,
  };
}

function entriesToTree(parentPath: string, entries: DeviceDirEntry[]): DeviceTreeEntry[] {
  const sorted = [...entries].sort(compareEntries);
  return sorted.map((e) => {
    const childPath = join(parentPath, e.name);
    if (e.isDir) {
      return {
        path: childPath,
        name: e.name,
        isDir: true,
        expanded: false,
        children: [],
      };
    }
    return { path: childPath, name: e.name, isDir: false };
  });
}

function compareEntries(a: DeviceDirEntry, b: DeviceDirEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function mergeChildren(
  oldChildren: DeviceTreeEntry[],
  newEntries: DeviceTreeEntry[],
): DeviceTreeEntry[] {
  const oldByPath = new Map<string, DeviceTreeEntry>();
  for (const c of oldChildren) oldByPath.set(c.path, c);
  return newEntries.map((entry) => {
    const old = oldByPath.get(entry.path);
    if (old && old.isDir && entry.isDir) {
      return { ...entry, expanded: old.expanded, children: old.children };
    }
    return entry;
  });
}

function findNode(tree: DeviceTreeNode | null, path: string): DeviceTreeNode | null {
  if (!tree) return null;
  if (tree.path === path) return tree;
  for (const child of tree.children) {
    if (child.isDir) {
      const found = findNode(child, path);
      if (found) return found;
    }
  }
  return null;
}

function isExpanded(tree: DeviceTreeNode | null, path: string): boolean {
  const node = findNode(tree, path);
  return !!node && node.expanded;
}

function updateNode(
  tree: DeviceTreeNode,
  path: string,
  updater: (node: DeviceTreeNode) => DeviceTreeNode,
): DeviceTreeNode {
  if (tree.path === path) return updater(tree);
  let changed = false;
  const newChildren = tree.children.map((c) => {
    if (c.isDir) {
      const updated = updateNode(c, path, updater);
      if (updated !== c) changed = true;
      return updated;
    }
    return c;
  });
  if (!changed) return tree;
  return { ...tree, children: newChildren };
}

function collectExpandedPaths(tree: DeviceTreeNode | null): string[] {
  const out: string[] = [];
  if (!tree) return out;
  const walk = (n: DeviceTreeNode) => {
    if (n.expanded) out.push(n.path);
    for (const c of n.children) {
      if (c.isDir) walk(c);
    }
  };
  walk(tree);
  return out;
}

async function removeDirRecursive(fs: DeviceFs, path: string): Promise<void> {
  const entries = await fs.list(path);
  for (const entry of entries) {
    const childPath = join(path, entry.name);
    if (entry.isDir) {
      await removeDirRecursive(fs, childPath);
    } else {
      await fs.removeFile(childPath);
    }
  }
  await fs.removeDir(path);
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
