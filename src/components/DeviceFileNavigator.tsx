// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DeviceTreeEntry, DeviceTreeNode } from '../hooks/useDeviceFs';
import { validateName } from '../lib/devicePath';

type CreateKind = 'file' | 'dir';

interface DeviceFileNavigatorProps {
  isAvailable: boolean;
  tree: DeviceTreeNode | null;
  busy: boolean;
  onExpand: (path: string) => void;
  onCollapse: (path: string) => void;
  onRefreshAll: () => void;
  onOpenFile: (path: string) => void;
  onCreateFile: (parentPath: string, name: string) => Promise<void>;
  onCreateDir: (parentPath: string, name: string) => Promise<void>;
  onRename: (path: string, newName: string) => Promise<void>;
  onDeleteFile: (path: string) => Promise<void>;
  onDeleteDir: (path: string, recursive: boolean) => Promise<void>;
  onCountChildren: (path: string) => Promise<number>;
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
  onCreateDir,
  onRename,
  onDeleteFile,
  onDeleteDir,
  onCountChildren,
}: DeviceFileNavigatorProps) {
  const [creating, setCreating] = useState<{ path: string; kind: CreateKind } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string } | null>(null);
  const [deleting, setDeleting] = useState<{ path: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: DeviceTreeEntry;
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

  // Drop any inline edit if the device disconnects mid-edit; the target
  // path becomes unreachable and the input would silently no-op. Uses the
  // "adjust state during render" pattern to avoid an effect-driven
  // cascading render.
  const [prevIsAvailable, setPrevIsAvailable] = useState(isAvailable);
  if (prevIsAvailable !== isAvailable) {
    setPrevIsAvailable(isAvailable);
    if (!isAvailable) {
      if (creating !== null) setCreating(null);
      if (renaming !== null) setRenaming(null);
      if (deleting !== null) setDeleting(null);
    }
  }

  const startCreate = (parentPath: string, kind: CreateKind, expanded: boolean) => {
    if (!expanded) onExpand(parentPath);
    setCreating({ path: parentPath, kind });
    setRenaming(null);
    setDeleting(null);
    setContextMenu(null);
  };

  const cancelCreate = () => setCreating(null);

  const submitCreate = async (parentPath: string, kind: CreateKind, name: string) => {
    if (kind === 'file') {
      await onCreateFile(parentPath, name);
    } else {
      await onCreateDir(parentPath, name);
    }
    setCreating(null);
  };

  const startRename = (path: string) => {
    setRenaming({ path });
    setCreating(null);
    setDeleting(null);
    setContextMenu(null);
  };

  const cancelRename = () => setRenaming(null);

  const submitRename = async (path: string, newName: string) => {
    await onRename(path, newName);
    setRenaming(null);
  };

  const startDelete = (path: string) => {
    setDeleting({ path });
    setCreating(null);
    setRenaming(null);
    setContextMenu(null);
  };

  const cancelDelete = () => setDeleting(null);

  const submitDelete = async (entry: DeviceTreeEntry, recursive: boolean) => {
    if (entry.isDir) {
      await onDeleteDir(entry.path, recursive);
    } else {
      await onDeleteFile(entry.path);
    }
    setDeleting(null);
  };

  const openContextMenu = (e: ReactMouseEvent, entry: DeviceTreeEntry) => {
    e.preventDefault();
    e.nativeEvent.stopImmediatePropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
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
            creating={creating}
            onStartCreate={startCreate}
            onCancelCreate={cancelCreate}
            onSubmitCreate={submitCreate}
            renaming={renaming}
            onStartRename={startRename}
            onCancelRename={cancelRename}
            onSubmitRename={submitRename}
            deleting={deleting}
            onStartDelete={startDelete}
            onCancelDelete={cancelDelete}
            onSubmitDelete={submitDelete}
            onCountChildren={onCountChildren}
            onContextMenu={openContextMenu}
          />
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(contextMenu.entry, startCreate, startRename, startDelete)}
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
  creating: { path: string; kind: CreateKind } | null;
  onStartCreate: (parentPath: string, kind: CreateKind, expanded: boolean) => void;
  onCancelCreate: () => void;
  onSubmitCreate: (parentPath: string, kind: CreateKind, name: string) => Promise<void>;
  renaming: { path: string } | null;
  onStartRename: (path: string) => void;
  onCancelRename: () => void;
  onSubmitRename: (path: string, newName: string) => Promise<void>;
  deleting: { path: string } | null;
  onStartDelete: (path: string) => void;
  onCancelDelete: () => void;
  onSubmitDelete: (entry: DeviceTreeEntry, recursive: boolean) => Promise<void>;
  onCountChildren: (path: string) => Promise<number>;
  onContextMenu: (e: ReactMouseEvent, entry: DeviceTreeEntry) => void;
}

function TreeRow({
  entry,
  depth,
  onExpand,
  onCollapse,
  onOpenFile,
  creating,
  onStartCreate,
  onCancelCreate,
  onSubmitCreate,
  renaming,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  deleting,
  onStartDelete,
  onCancelDelete,
  onSubmitDelete,
  onCountChildren,
  onContextMenu,
}: TreeRowProps) {
  const indent = 8 + depth * 12;
  const isRenaming = renaming?.path === entry.path;
  const isDeleting = deleting?.path === entry.path;
  const isRoot = entry.path === '/';
  if (entry.isDir) {
    const toggle = () => (entry.expanded ? onCollapse(entry.path) : onExpand(entry.path));
    return (
      <>
        {isRenaming ? (
          <RenameEntryInput
            entry={entry}
            depth={depth}
            onCancel={onCancelRename}
            onSubmit={onSubmitRename}
          />
        ) : isDeleting ? (
          <DeleteConfirmRow
            entry={entry}
            depth={depth}
            onCancel={onCancelDelete}
            onSubmit={onSubmitDelete}
            onCountChildren={onCountChildren}
          />
        ) : (
          <div
            className="group flex items-center hover:bg-accent transition-colors"
            onContextMenu={(e) => onContextMenu(e, entry)}
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
                onStartCreate(entry.path, 'dir', entry.expanded);
              }}
              title="New folder"
              aria-label={`New folder in ${entry.name}`}
              className="p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/10 transition-opacity"
            >
              <FolderPlus size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartCreate(entry.path, 'file', entry.expanded);
              }}
              title="New file"
              aria-label={`New file in ${entry.name}`}
              className="p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/10 transition-opacity"
            >
              <Plus size={12} />
            </button>
            {!isRoot && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartRename(entry.path);
                  }}
                  title="Rename"
                  aria-label={`Rename ${entry.name}`}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/10 transition-opacity"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartDelete(entry.path);
                  }}
                  title="Delete"
                  aria-label={`Delete ${entry.name}`}
                  className="p-1 mr-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/10 transition-opacity"
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        )}
        {entry.expanded && (
          <>
            {creating?.path === entry.path && (
              <CreateEntryInput
                parentPath={entry.path}
                kind={creating.kind}
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
                creating={creating}
                onStartCreate={onStartCreate}
                onCancelCreate={onCancelCreate}
                onSubmitCreate={onSubmitCreate}
                renaming={renaming}
                onStartRename={onStartRename}
                onCancelRename={onCancelRename}
                onSubmitRename={onSubmitRename}
                deleting={deleting}
                onStartDelete={onStartDelete}
                onCancelDelete={onCancelDelete}
                onSubmitDelete={onSubmitDelete}
                onCountChildren={onCountChildren}
                onContextMenu={onContextMenu}
              />
            ))}
          </>
        )}
      </>
    );
  }
  if (isRenaming) {
    return (
      <RenameEntryInput
        entry={entry}
        depth={depth}
        onCancel={onCancelRename}
        onSubmit={onSubmitRename}
      />
    );
  }
  if (isDeleting) {
    return (
      <DeleteConfirmRow
        entry={entry}
        depth={depth}
        onCancel={onCancelDelete}
        onSubmit={onSubmitDelete}
        onCountChildren={onCountChildren}
      />
    );
  }
  return (
    <div
      className="group flex items-center hover:bg-accent transition-colors"
      onContextMenu={(e) => onContextMenu(e, entry)}
    >
      <button
        onClick={() => onOpenFile(entry.path)}
        style={{ paddingLeft: indent + 12 }}
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left pr-1 py-1 text-sm truncate"
      >
        <File size={14} className="shrink-0" />
        <span className="truncate">{entry.name}</span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStartRename(entry.path);
        }}
        title="Rename"
        aria-label={`Rename ${entry.name}`}
        className="p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/10 transition-opacity"
      >
        <Pencil size={12} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStartDelete(entry.path);
        }}
        title="Delete"
        aria-label={`Delete ${entry.name}`}
        className="p-1 mr-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-foreground/10 transition-opacity"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

interface CreateEntryInputProps {
  parentPath: string;
  kind: CreateKind;
  depth: number;
  onCancel: () => void;
  onSubmit: (parentPath: string, kind: CreateKind, name: string) => Promise<void>;
}

function CreateEntryInput({
  parentPath,
  kind,
  depth,
  onCancel,
  onSubmit,
}: CreateEntryInputProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const indent = 8 + depth * 12;
  const isFile = kind === 'file';
  const Icon = isFile ? File : Folder;
  const placeholder = isFile ? 'filename.py' : 'foldername';
  const ariaLabel = isFile ? 'New file name' : 'New folder name';

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
      await onSubmit(parentPath, kind, name);
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
        <Icon size={14} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={submitting}
          placeholder={placeholder}
          aria-label={ariaLabel}
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

interface RenameEntryInputProps {
  entry: DeviceTreeEntry;
  depth: number;
  onCancel: () => void;
  onSubmit: (path: string, newName: string) => Promise<void>;
}

function RenameEntryInput({ entry, depth, onCancel, onSubmit }: RenameEntryInputProps) {
  const [name, setName] = useState(entry.name);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const indent = 8 + depth * 12;
  const isFile = !entry.isDir;
  const Icon = isFile ? File : Folder;

  useEffect(() => {
    inputRef.current?.focus();
    // Select the stem so editing the name (not the extension) is the
    // common case for files; for directories select the whole name.
    const dotIdx = isFile ? entry.name.lastIndexOf('.') : -1;
    const selectionEnd = dotIdx > 0 ? dotIdx : entry.name.length;
    inputRef.current?.setSelectionRange(0, selectionEnd);
  }, [entry.name, isFile]);

  const validation = validateName(name);
  const isUnchanged = name === entry.name;
  const showRejection = name.length > 0 && !validation.ok;
  const canSubmit = validation.ok && !submitting && !isUnchanged;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(entry.path, name);
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
    <div
      style={{ paddingLeft: isFile ? indent + 12 : indent }}
      className="flex flex-col py-0.5 pr-2 gap-0.5"
    >
      <div className="flex items-center gap-1.5">
        {!isFile &&
          (entry.isDir && entry.expanded ? (
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
          ))}
        <Icon size={14} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={submitting}
          aria-label={`Rename ${entry.name}`}
          aria-invalid={showRejection || !!submitError}
          className="flex-1 min-w-0 px-1 py-0.5 text-sm bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Rename
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

interface DeleteConfirmRowProps {
  entry: DeviceTreeEntry;
  depth: number;
  onCancel: () => void;
  onSubmit: (entry: DeviceTreeEntry, recursive: boolean) => Promise<void>;
  onCountChildren: (path: string) => Promise<number>;
}

function DeleteConfirmRow({
  entry,
  depth,
  onCancel,
  onSubmit,
  onCountChildren,
}: DeleteConfirmRowProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // For directories, the count of immediate children drives both the prompt
  // wording and whether we dispatch a recursive delete. `null` means "still
  // loading"; we show the row but disable Delete until the count is in.
  const [childCount, setChildCount] = useState<number | null>(entry.isDir ? null : 0);
  const [countError, setCountError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const indent = 8 + depth * 12;
  const isFile = !entry.isDir;
  const Icon = isFile ? File : Folder;

  // Default the focus to Confirm so Enter accepts and Esc cancels without
  // the user having to click into the row first.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!entry.isDir) return;
    let cancelled = false;
    onCountChildren(entry.path)
      .then((n) => {
        if (!cancelled) setChildCount(n);
      })
      .catch((err) => {
        if (!cancelled) setCountError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [entry.isDir, entry.path, onCountChildren]);

  const recursive = (childCount ?? 0) > 0;
  const ready = childCount !== null;
  const prompt = !ready
    ? `Delete ${entry.name}?`
    : recursive
      ? `Delete ${entry.name} and ${childCount} item${childCount === 1 ? '' : 's'} inside?`
      : `Delete ${entry.name}?`;

  const handleSubmit = async () => {
    if (submitting || !ready) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(entry, recursive);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      style={{ paddingLeft: isFile ? indent + 12 : indent }}
      className="flex flex-col py-0.5 pr-2 gap-0.5"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-1.5">
        {!isFile &&
          (entry.isDir && entry.expanded ? (
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
          ))}
        <Icon size={14} className="shrink-0 text-muted-foreground" />
        <span className="flex-1 min-w-0 truncate text-sm">{prompt}</span>
        <button
          ref={confirmRef}
          onClick={handleSubmit}
          disabled={submitting || !ready}
          className="px-2 py-0.5 text-xs rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          className="px-2 py-0.5 text-xs rounded hover:bg-accent transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
      {countError && (
        <div className="text-xs text-destructive pl-5">
          Couldn't read directory: {countError}
        </div>
      )}
      {submitError && <div className="text-xs text-destructive pl-5">{submitError}</div>}
    </div>
  );
}

interface ContextMenuItem {
  label: string;
  onClick: () => void;
}

function buildContextMenuItems(
  entry: DeviceTreeEntry,
  startCreate: (parentPath: string, kind: CreateKind, expanded: boolean) => void,
  startRename: (path: string) => void,
  startDelete: (path: string) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (entry.isDir) {
    items.push({
      label: 'New file',
      onClick: () => startCreate(entry.path, 'file', entry.expanded),
    });
    items.push({
      label: 'New folder',
      onClick: () => startCreate(entry.path, 'dir', entry.expanded),
    });
  }
  if (entry.path !== '/') {
    items.push({ label: 'Rename', onClick: () => startRename(entry.path) });
    items.push({ label: 'Delete', onClick: () => startDelete(entry.path) });
  }
  return items;
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
