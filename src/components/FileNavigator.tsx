// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useState } from 'react';
import type { DragEvent as ReactDragEvent, RefObject } from 'react';
import { basename } from '../lib/devicePath';
import {
  clearFolderHandle,
  loadFolderHandle,
  saveFolderHandle,
} from '../lib/handleStore';
import {
  DEVICE_PATH_MIME,
  LOCAL_PATH_MIME,
  clearLocalDragSource,
  registerLocalDragSource,
} from '../lib/localDragSource';

interface LocalTreeNode {
  handle: FileSystemDirectoryHandle;
  name: string;
  isDir: true;
  expanded: boolean;
  children: LocalTreeEntry[];
}

interface LocalTreeFile {
  handle: FileSystemFileHandle;
  name: string;
  isDir: false;
}

type LocalTreeEntry = LocalTreeNode | LocalTreeFile;

export interface FileNavigatorHandle {
  /**
   * Download a file from the device into the open local folder. Used by the
   * device pane's right-click "Download" so the local pane stays the single
   * owner of the local-FS handle and tree state.
   */
  downloadFromDevice(devicePath: string): Promise<void>;
}

interface FileNavigatorProps {
  onFileSelected: (content: string) => void;
  onDeviceReadBytes: (path: string) => Promise<Uint8Array>;
  onShowMessage: (message: string) => void;
  ref?: RefObject<FileNavigatorHandle | null>;
}

export function FileNavigator({
  onFileSelected,
  onDeviceReadBytes,
  onShowMessage,
  ref,
}: FileNavigatorProps) {
  const [root, setRoot] = useState<LocalTreeNode | null>(null);
  // A handle was restored from IndexedDB but the browser still requires the
  // user to re-grant readwrite permission. Triggers the "Reopen" button in
  // the header, which calls requestPermission inside the click gesture.
  const [pendingHandle, setPendingHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isDeviceDragOver, setIsDeviceDragOver] = useState(false);

  const setRootFromHandle = (handle: FileSystemDirectoryHandle, children: LocalTreeEntry[]) => {
    setRoot({
      handle,
      name: handle.name,
      isDir: true,
      expanded: true,
      children,
    });
  };

  const openDirectory = async () => {
    const dirHandle = await window.showDirectoryPicker();
    const children = await loadChildren(dirHandle);
    setRootFromHandle(dirHandle, children);
    setPendingHandle(null);
    await saveFolderHandle(dirHandle);
  };

  // Mount-time restore: if a handle is persisted and permission is still
  // granted, reopen silently. If the browser requires a re-grant, surface a
  // "Reopen" button instead of opening unprompted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const handle = await loadFolderHandle();
      if (cancelled || !handle) return;
      let perm: PermissionState;
      try {
        perm = await handle.queryPermission({ mode: 'readwrite' });
      } catch {
        // queryPermission unsupported — fall back to manual Open Folder.
        return;
      }
      if (cancelled) return;
      if (perm === 'granted') {
        try {
          const children = await loadChildren(handle);
          if (cancelled) return;
          setRootFromHandle(handle, children);
        } catch {
          // Folder no longer exists, was renamed, or permission revoked
          // mid-iterate. Drop the stale handle.
          await clearFolderHandle();
        }
      } else {
        setPendingHandle(handle);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reopenPending = async () => {
    if (!pendingHandle) return;
    try {
      const perm = await pendingHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        // User declined — reveal the regular Open Folder button so they
        // can pick a different folder.
        setPendingHandle(null);
        return;
      }
      const children = await loadChildren(pendingHandle);
      setRootFromHandle(pendingHandle, children);
      setPendingHandle(null);
    } catch {
      // Folder gone, permission API failure, etc. Drop the stale handle.
      setPendingHandle(null);
      await clearFolderHandle();
    }
  };

  const toggleFolder = async (path: string[]) => {
    if (!root) return;
    const node = findNode(root, path);
    if (!node) return;
    if (node.expanded) {
      setRoot((r) => (r ? updateNode(r, path, (n) => ({ ...n, expanded: false })) : r));
      return;
    }
    const children = node.children.length === 0 ? await loadChildren(node.handle) : node.children;
    setRoot((r) =>
      r ? updateNode(r, path, (n) => ({ ...n, expanded: true, children })) : r,
    );
  };

  const openFile = async (handle: FileSystemFileHandle) => {
    const file = await handle.getFile();
    const content = await file.text();
    onFileSelected(content);
  };

  const downloadFromDevice = useCallback(
    async (devicePath: string): Promise<void> => {
      if (!root) {
        onShowMessage('Open a local folder first.');
        return;
      }
      const name = basename(devicePath);
      const bytes = await onDeviceReadBytes(devicePath);
      const fileHandle = await root.handle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(bytes);
      } finally {
        await writable.close();
      }
      // Surface the new (or overwritten) file in the tree without losing the
      // expansion state of unrelated subtrees: re-list root and merge.
      const refreshed = await loadChildren(root.handle);
      setRoot((r) => (r ? mergeRootChildren(r, refreshed) : r));
    },
    [root, onDeviceReadBytes, onShowMessage],
  );

  useImperativeHandle(ref, () => ({ downloadFromDevice }), [downloadFromDevice]);

  const acceptsDeviceDrop = (dt: DataTransfer): boolean =>
    dt.types.includes(DEVICE_PATH_MIME);

  const handleDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!acceptsDeviceDrop(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDeviceDragOver) setIsDeviceDragOver(true);
  };

  const handleDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setIsDeviceDragOver(false);
  };

  const handleDrop = async (e: ReactDragEvent<HTMLDivElement>) => {
    if (!acceptsDeviceDrop(e.dataTransfer)) return;
    e.preventDefault();
    setIsDeviceDragOver(false);
    const devicePath = e.dataTransfer.getData(DEVICE_PATH_MIME);
    if (!devicePath) return;
    try {
      await downloadFromDevice(devicePath);
    } catch (err) {
      onShowMessage(
        `Download failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div
      className={`flex flex-col h-full bg-muted/30 transition-colors ${
        isDeviceDragOver ? 'outline outline-2 outline-primary/40 bg-primary/5' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        void handleDrop(e);
      }}
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        {pendingHandle ? (
          <button
            onClick={reopenPending}
            title={`Reopen ${pendingHandle.name}`}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-sm hover:bg-accent transition-colors w-full min-w-0"
          >
            <FolderOpen size={14} className="shrink-0" />
            <span className="truncate">
              Reopen <em>{pendingHandle.name}</em>
            </span>
          </button>
        ) : (
          <button
            onClick={openDirectory}
            title="Open folder"
            className="flex items-center gap-1.5 px-2 py-1 rounded text-sm hover:bg-accent transition-colors w-full"
          >
            <FolderOpen size={14} />
            Open Folder
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {root && (
          <TreeRow
            entry={root}
            path={[]}
            depth={0}
            onToggle={toggleFolder}
            onOpenFile={openFile}
          />
        )}
      </div>
    </div>
  );
}

interface TreeRowProps {
  entry: LocalTreeEntry;
  path: string[];
  depth: number;
  onToggle: (path: string[]) => void;
  onOpenFile: (handle: FileSystemFileHandle) => void;
}

function TreeRow({ entry, path, depth, onToggle, onOpenFile }: TreeRowProps) {
  const indent = 8 + depth * 12;
  if (entry.isDir) {
    return (
      <>
        <button
          onClick={() => onToggle(path)}
          style={{ paddingLeft: indent }}
          className="flex items-center gap-1.5 w-full text-left pr-2 py-1 text-sm hover:bg-accent transition-colors truncate"
        >
          {entry.expanded ? (
            <ChevronDown size={12} className="shrink-0" />
          ) : (
            <ChevronRight size={12} className="shrink-0" />
          )}
          <Folder size={14} className="shrink-0" />
          <span className="truncate">{entry.name}</span>
        </button>
        {entry.expanded &&
          entry.children.map((child) => (
            <TreeRow
              key={child.name}
              entry={child}
              path={[...path, child.name]}
              depth={depth + 1}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))}
      </>
    );
  }
  return <FileTreeRow entry={entry} indent={indent} onOpenFile={onOpenFile} />;
}

interface FileTreeRowProps {
  entry: LocalTreeFile;
  indent: number;
  onOpenFile: (handle: FileSystemFileHandle) => void;
}

function FileTreeRow({ entry, indent, onOpenFile }: FileTreeRowProps) {
  const [dragId, setDragId] = useState<string | null>(null);

  const onDragStart = (e: ReactDragEvent<HTMLButtonElement>) => {
    const id = registerLocalDragSource(entry.handle, entry.name);
    e.dataTransfer.setData(LOCAL_PATH_MIME, id);
    e.dataTransfer.effectAllowed = 'copy';
    setDragId(id);
  };

  const onDragEnd = () => {
    if (dragId) {
      // Drop targets `consume` the source on success; `clear` is a no-op
      // there. On a cancelled drag the entry would otherwise leak.
      clearLocalDragSource(dragId);
      setDragId(null);
    }
  };

  return (
    <button
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpenFile(entry.handle)}
      style={{ paddingLeft: indent + 12 }}
      className="flex items-center gap-1.5 w-full text-left pr-2 py-1 text-sm hover:bg-accent transition-colors truncate"
    >
      <File size={14} className="shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

async function loadChildren(dirHandle: FileSystemDirectoryHandle): Promise<LocalTreeEntry[]> {
  const entries: LocalTreeEntry[] = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') {
      entries.push({
        handle: handle as FileSystemDirectoryHandle,
        name,
        isDir: true,
        expanded: false,
        children: [],
      });
    } else {
      entries.push({
        handle: handle as FileSystemFileHandle,
        name,
        isDir: false,
      });
    }
  }
  entries.sort(compareEntries);
  return entries;
}

function compareEntries(a: LocalTreeEntry, b: LocalTreeEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name);
}

// Re-list root preserves expansion state of unrelated folders by carrying
// over the previous (expanded, children) for any directory child whose name
// survived the re-list. New entries (e.g. the freshly downloaded file) appear
// in their sorted position; deleted entries drop out.
function mergeRootChildren(
  root: LocalTreeNode,
  refreshed: LocalTreeEntry[],
): LocalTreeNode {
  const oldByName = new Map<string, LocalTreeEntry>();
  for (const c of root.children) oldByName.set(c.name, c);
  const merged = refreshed.map((entry) => {
    const old = oldByName.get(entry.name);
    if (old && old.isDir && entry.isDir) {
      return { ...entry, expanded: old.expanded, children: old.children };
    }
    return entry;
  });
  return { ...root, children: merged };
}

function findNode(root: LocalTreeNode, path: string[]): LocalTreeNode | null {
  let node: LocalTreeNode = root;
  for (const segment of path) {
    const next = node.children.find((c) => c.isDir && c.name === segment);
    if (!next || !next.isDir) return null;
    node = next;
  }
  return node;
}

function updateNode(
  root: LocalTreeNode,
  path: string[],
  updater: (node: LocalTreeNode) => LocalTreeNode,
): LocalTreeNode {
  if (path.length === 0) return updater(root);
  const [head, ...rest] = path;
  let changed = false;
  const newChildren = root.children.map((c) => {
    if (c.isDir && c.name === head) {
      const updated = updateNode(c, rest, updater);
      if (updated !== c) changed = true;
      return updated;
    }
    return c;
  });
  if (!changed) return root;
  return { ...root, children: newChildren };
}
