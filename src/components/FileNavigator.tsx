// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
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

interface FileNavigatorProps {
  onFileSelected: (content: string) => void;
}

export function FileNavigator({ onFileSelected }: FileNavigatorProps) {
  const [root, setRoot] = useState<LocalTreeNode | null>(null);

  const openDirectory = async () => {
    const dirHandle = await window.showDirectoryPicker();
    const children = await loadChildren(dirHandle);
    setRoot({
      handle: dirHandle,
      name: dirHandle.name,
      isDir: true,
      expanded: true,
      children,
    });
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

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        <button
          onClick={openDirectory}
          title="Open folder"
          className="flex items-center gap-1.5 px-2 py-1 rounded text-sm hover:bg-accent transition-colors w-full"
        >
          <FolderOpen size={14} />
          Open Folder
        </button>
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
