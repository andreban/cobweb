// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { ChevronDown, ChevronRight, File, Folder, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DeviceTreeEntry, DeviceTreeNode } from '../hooks/useDeviceFs';
import { validateName } from '../lib/devicePath';

interface DeviceFileNavigatorProps {
  isAvailable: boolean;
  tree: DeviceTreeNode | null;
  busy: boolean;
  onExpand: (path: string) => void;
  onCollapse: (path: string) => void;
  onRefreshAll: () => void;
  onOpenFile: (path: string) => void;
  onCreateFile: (parentPath: string, name: string) => Promise<void>;
}

export function DeviceFileNavigator({
  isAvailable,
  tree,
  busy,
  onExpand,
  onCollapse,
  onRefreshAll,
  onOpenFile,
  onCreateFile,
}: DeviceFileNavigatorProps) {
  const [creatingInPath, setCreatingInPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    expanded: boolean;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOnClick = () => setContextMenu(null);
    const closeOnKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', closeOnClick);
    window.addEventListener('scroll', closeOnClick, true);
    window.addEventListener('keydown', closeOnKey);
    return () => {
      window.removeEventListener('click', closeOnClick);
      window.removeEventListener('scroll', closeOnClick, true);
      window.removeEventListener('keydown', closeOnKey);
    };
  }, [contextMenu]);

  // Drop the inline create input if the device disconnects mid-edit; the
  // target path becomes unreachable and the input would silently no-op.
  // Uses the "adjust state during render" pattern to avoid an effect-driven
  // cascading render.
  const [prevIsAvailable, setPrevIsAvailable] = useState(isAvailable);
  if (prevIsAvailable !== isAvailable) {
    setPrevIsAvailable(isAvailable);
    if (!isAvailable && creatingInPath !== null) setCreatingInPath(null);
  }

  const startCreate = (parentPath: string, expanded: boolean) => {
    if (!expanded) onExpand(parentPath);
    setCreatingInPath(parentPath);
    setContextMenu(null);
  };

  const cancelCreate = () => setCreatingInPath(null);

  const submitCreate = async (parentPath: string, name: string) => {
    await onCreateFile(parentPath, name);
    setCreatingInPath(null);
  };

  const openContextMenu = (
    e: ReactMouseEvent,
    path: string,
    expanded: boolean,
  ) => {
    e.preventDefault();
    e.nativeEvent.stopImmediatePropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path, expanded });
  };

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
          <TreeRow
            entry={tree}
            depth={0}
            onExpand={onExpand}
            onCollapse={onCollapse}
            onOpenFile={onOpenFile}
            creatingInPath={creatingInPath}
            onStartCreate={startCreate}
            onCancelCreate={cancelCreate}
            onSubmitCreate={submitCreate}
            onContextMenu={openContextMenu}
          />
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: 'New file',
              onClick: () => startCreate(contextMenu.path, contextMenu.expanded),
            },
          ]}
        />
      )}
    </div>
  );
}

interface TreeRowProps {
  entry: DeviceTreeEntry;
  depth: number;
  onExpand: (path: string) => void;
  onCollapse: (path: string) => void;
  onOpenFile: (path: string) => void;
  creatingInPath: string | null;
  onStartCreate: (parentPath: string, expanded: boolean) => void;
  onCancelCreate: () => void;
  onSubmitCreate: (parentPath: string, name: string) => Promise<void>;
  onContextMenu: (e: ReactMouseEvent, path: string, expanded: boolean) => void;
}

function TreeRow({
  entry,
  depth,
  onExpand,
  onCollapse,
  onOpenFile,
  creatingInPath,
  onStartCreate,
  onCancelCreate,
  onSubmitCreate,
  onContextMenu,
}: TreeRowProps) {
  const indent = 8 + depth * 12;
  if (entry.isDir) {
    const toggle = () => (entry.expanded ? onCollapse(entry.path) : onExpand(entry.path));
    return (
      <>
        <div
          className="group flex items-center hover:bg-accent transition-colors"
          onContextMenu={(e) => onContextMenu(e, entry.path, entry.expanded)}
        >
          <button
            onClick={toggle}
            style={{ paddingLeft: indent }}
            className="flex items-center gap-1.5 flex-1 min-w-0 text-left pr-1 py-1 text-sm"
          >
            {entry.expanded ? (
              <ChevronDown size={12} className="shrink-0" />
            ) : (
              <ChevronRight size={12} className="shrink-0" />
            )}
            <Folder size={14} className="shrink-0" />
            <span className="truncate">{entry.name}</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartCreate(entry.path, entry.expanded);
            }}
            title="New file"
            aria-label={`New file in ${entry.name}`}
            className="p-1 mr-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/10 transition-opacity"
          >
            <Plus size={12} />
          </button>
        </div>
        {entry.expanded && (
          <>
            {creatingInPath === entry.path && (
              <CreateFileInput
                parentPath={entry.path}
                depth={depth + 1}
                onCancel={onCancelCreate}
                onSubmit={onSubmitCreate}
              />
            )}
            {entry.children.map((child) => (
              <TreeRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                onExpand={onExpand}
                onCollapse={onCollapse}
                onOpenFile={onOpenFile}
                creatingInPath={creatingInPath}
                onStartCreate={onStartCreate}
                onCancelCreate={onCancelCreate}
                onSubmitCreate={onSubmitCreate}
                onContextMenu={onContextMenu}
              />
            ))}
          </>
        )}
      </>
    );
  }
  return (
    <button
      onClick={() => onOpenFile(entry.path)}
      style={{ paddingLeft: indent + 12 }}
      className="flex items-center gap-1.5 w-full text-left pr-2 py-1 text-sm hover:bg-accent transition-colors truncate"
    >
      <File size={14} className="shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

interface CreateFileInputProps {
  parentPath: string;
  depth: number;
  onCancel: () => void;
  onSubmit: (parentPath: string, name: string) => Promise<void>;
}

function CreateFileInput({ parentPath, depth, onCancel, onSubmit }: CreateFileInputProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const indent = 8 + depth * 12;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validation = validateName(name);
  const showRejection = name.length > 0 && !validation.ok;
  const canSubmit = validation.ok && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(parentPath, name);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div style={{ paddingLeft: indent + 12 }} className="flex flex-col py-0.5 pr-2 gap-0.5">
      <div className="flex items-center gap-1.5">
        <File size={14} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={submitting}
          placeholder="filename.py"
          aria-label="New file name"
          aria-invalid={showRejection || !!submitError}
          className="flex-1 min-w-0 px-1 py-0.5 text-sm bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          className="px-2 py-0.5 text-xs rounded hover:bg-accent transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
      {(showRejection || submitError) && (
        <div className="text-xs text-destructive pl-5">
          {submitError ?? (validation.ok ? null : validation.reason)}
        </div>
      )}
    </div>
  );
}

interface ContextMenuItem {
  label: string;
  onClick: () => void;
}

function ContextMenu({ x, y, items }: { x: number; y: number; items: ContextMenuItem[] }) {
  return (
    <div
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-[140px] py-1 rounded shadow-md bg-popover text-popover-foreground border border-border text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.onClick}
          className="block w-full text-left px-3 py-1 hover:bg-accent transition-colors"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
