// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { ChevronDown, ChevronRight, File, Folder, Loader2, RefreshCw } from 'lucide-react';
import type { DeviceTreeEntry, DeviceTreeNode } from '../hooks/useDeviceFs';

interface DeviceFileNavigatorProps {
  isAvailable: boolean;
  tree: DeviceTreeNode | null;
  busy: boolean;
  onExpand: (path: string) => void;
  onCollapse: (path: string) => void;
  onRefreshAll: () => void;
}

export function DeviceFileNavigator({
  isAvailable,
  tree,
  busy,
  onExpand,
  onCollapse,
  onRefreshAll,
}: DeviceFileNavigatorProps) {
  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        <span className="px-2 py-1 text-sm font-medium flex-1">Device Files</span>
        {busy && (
          <Loader2
            size={14}
            className="animate-spin text-muted-foreground shrink-0"
            aria-label="Working"
          />
        )}
        <button
          onClick={onRefreshAll}
          disabled={!isAvailable || busy}
          title="Refresh"
          aria-label="Refresh"
          className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!isAvailable || !tree ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            Connect a device to browse its files.
          </div>
        ) : (
          <TreeRow entry={tree} depth={0} onExpand={onExpand} onCollapse={onCollapse} />
        )}
      </div>
    </div>
  );
}

interface TreeRowProps {
  entry: DeviceTreeEntry;
  depth: number;
  onExpand: (path: string) => void;
  onCollapse: (path: string) => void;
}

function TreeRow({ entry, depth, onExpand, onCollapse }: TreeRowProps) {
  const indent = 8 + depth * 12;
  if (entry.isDir) {
    const toggle = () => (entry.expanded ? onCollapse(entry.path) : onExpand(entry.path));
    return (
      <>
        <button
          onClick={toggle}
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
              key={child.path}
              entry={child}
              depth={depth + 1}
              onExpand={onExpand}
              onCollapse={onCollapse}
            />
          ))}
      </>
    );
  }
  return (
    <div
      style={{ paddingLeft: indent + 12 }}
      className="flex items-center gap-1.5 w-full pr-2 py-1 text-sm text-muted-foreground truncate cursor-default"
    >
      <File size={14} className="shrink-0" />
      <span className="truncate">{entry.name}</span>
    </div>
  );
}
