# UI State Persistence — Technical Specification

## Overview

Four independent persistence mechanisms, each scoped to one concern and one storage key. Layout and editor buffer use localStorage (small, synchronous, JSON). Device port identity uses localStorage (USB IDs are integers). Local folder handle uses IndexedDB because `FileSystemDirectoryHandle` is structured-cloneable but not JSON-serialisable.

Existing persisted state in the app:

| Concern | Storage | Key |
|---------|---------|-----|
| Agent conversation | localStorage | `cobweb:conversation` |
| Theme preference | localStorage | `cobweb:theme` |
| Provider config | localStorage | `cobweb:provider-config` |

New keys added by this feature follow the same `cobweb:` prefix.

---

## 1. Layout (split sizes + panel visibility)

### State to persist

From `src/App.tsx:276-282`:

```ts
leftOpen, leftSize, rightOpen, rightSize, replOpen, replSize, leftSplitSize
```

### Storage

**Key:** `cobweb:layout`
**Shape:**
```ts
interface PersistedLayout {
  leftOpen: boolean;
  leftSize: number;
  rightOpen: boolean;
  rightSize: number;
  replOpen: boolean;
  replSize: number;
  leftSplitSize: number;
}
```

### Implementation

- A new `useLayout` hook in `src/hooks/useLayout.ts` owns the seven values, exposing the same setters `App.tsx` uses today.
- On mount, read `cobweb:layout`; fall back to current defaults (20 / 35 / 40 / 50 / all open) on missing or malformed JSON.
- On any setter call, write the full object back to localStorage. No debouncing — split-drag setters fire on `mousemove`, but localStorage writes of a ~100-byte JSON object are well under 1 ms; profile only if the browser flags jank.
- Numeric ranges are clamped on read to `[0, 100]` to defend against corrupted entries.
- `App.tsx` replaces its seven `useState` calls with `const layout = useLayout();` and threads `layout.leftSize`, `layout.setLeftSize`, etc.

### Tests

`src/hooks/useLayout.test.ts` — round-trips defaults, restores stored values, ignores malformed JSON, clamps out-of-range numbers.

---

## 2. Editor untitled buffer

### State to persist

The editor's text content, but **only when** `useEditor.origin.kind === 'untitled'`. Local-file and device-file origins manage their own persistence via the file system and the device respectively; persisting them here would either duplicate the source of truth or get out of sync.

### Storage

**Key:** `cobweb:editor:untitled`
**Shape:** the raw string (no JSON wrap).

### Implementation

In `src/hooks/useEditor.ts`:

- On editor mount, after the `EditorView` is created, read `cobweb:editor:untitled`. If non-empty, set the document content and the `snapshotRef` to that value. Origin remains `{ kind: 'untitled' }`. `isModified` stays `false` (the snapshot matches the content).
- Extend the existing `modifiedListener` (line 29): on each `docChanged`, if `origin.kind === 'untitled'`, write the current content to localStorage. If `origin.kind !== 'untitled'`, leave the stored value alone — it'll be cleared by the next untitled open or remain available if the user returns to untitled.
- In `setOriginAndContent`: if the new origin is `untitled`, write the new content to localStorage. If the new origin is `local` or `device`, **clear** `cobweb:editor:untitled` (the user has moved on; the orphan untitled buffer would otherwise reappear next reload).
- The current `useEffect` that creates the editor (line 26) reads `origin` indirectly via the ref state; the restoration step must run inside that effect after `viewRef.current` is set, before returning.

### Edge cases

- Restored content is large (>1 MB): localStorage will throw `QuotaExceededError`. Wrap writes in try/catch and silently no-op on quota failure — losing the in-flight save is preferable to an unhandled exception.
- The buffer at restore time is empty string: skip the restore (no point dispatching a no-op change).

### Tests

`src/hooks/useEditor.test.ts` — restore on mount when key is set, no restore when missing, write on edit while untitled, no write while local/device, clear on transition away from untitled.

---

## 3. Auto-reconnect last device

### State to persist

USB vendor ID + product ID of the last successfully-connected serial port.

### Storage

**Key:** `cobweb:lastDevice`
**Shape:**
```ts
interface PersistedDevice {
  usbVendorId: number;
  usbProductId: number;
}
```

### Implementation

In `src/hooks/useReplConnection.ts`:

- After a successful `connect()` call (line 55, immediately before `setConnectionState('connected')`), call `port.getInfo()` on the underlying `SerialPort` and store `{ usbVendorId, usbProductId }` to localStorage. (`ReplInterface` currently hides the port; expose it via a getter `getPortInfo(): { usbVendorId?: number; usbProductId?: number } | null` on `ReplInterface`.)
- On `useReplConnection` mount (new `useEffect` with empty deps), call `navigator.serial.getPorts()`. For each granted port, call `getInfo()` and look for one whose `usbVendorId` and `usbProductId` match the persisted entry.
  - **Exactly one match:** call a new `ReplInterface.connectToPort(port)` static method that mirrors `connect()` but skips the `requestPort()` chooser. Then run the same wiring as `connect()`.
  - **Zero matches or multiple matches:** do nothing. (Multiple matches means the user has more than one identical board plugged in; auto-picking would be wrong, and silently doing nothing is consistent with first-time-visit behaviour.)
- On user-initiated `disconnect()`, leave the persisted entry alone — disconnect is a transient action; the user likely wants the same device back next session. Only overwrite on a *successful new connect*.
- If auto-reconnect throws (port stale, device removed mid-load), swallow the error and stay disconnected. The user can click Connect manually.

### `ReplInterface` changes

- Expose `getPortInfo(): { usbVendorId?: number; usbProductId?: number } | null` (returns `null` if no port).
- Add `static connectToPort(port: SerialPort): Promise<ReplInterface>` — same as the body of `connect()` but takes the port as an argument instead of calling `navigator.serial.requestPort()`.

### Tests

`src/hooks/useReplConnection.test.ts` — mock `navigator.serial.getPorts` to return zero / one / two matching ports, verify auto-reconnect happens only on the one-match case, verify localStorage is written after a successful connect.

`src/ReplInterface.test.ts` — `connectToPort` opens the given port and produces an interface equivalent to `connect()`.

---

## 4. Reopen last local folder

### State to persist

`FileSystemDirectoryHandle` for the most recently opened local folder.

### Storage

**Database:** `cobweb` (IndexedDB)
**Object store:** `handles`
**Key:** `lastFolder`
**Value:** the `FileSystemDirectoryHandle` instance (structured-cloneable).

A small helper module `src/lib/handleStore.ts` wraps the IndexedDB calls:

```ts
export async function saveFolderHandle(handle: FileSystemDirectoryHandle): Promise<void>;
export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | null>;
export async function clearFolderHandle(): Promise<void>;
```

Implemented with the raw `indexedDB` API (no library dependency) — the surface is tiny and adding `idb-keyval` for one key isn't worth it.

### Implementation

In `src/components/FileNavigator.tsx`:

- On mount (new `useEffect`), call `loadFolderHandle()`. If a handle is returned:
  - Call `handle.queryPermission({ mode: 'readwrite' })`.
  - If `'granted'`: load children and set root, identical to `openDirectory`'s success path.
  - If `'prompt'` or `'denied'`: set the handle into a new `pendingHandle` state and render a "Reopen *<folder name>*" button in the header (replacing the existing "Open Folder" button when `pendingHandle` is set).
  - Clicking "Reopen": call `handle.requestPermission({ mode: 'readwrite' })` (must be in user-gesture stack). On `'granted'`, load children and set root; clear `pendingHandle`. On denial, fall back to the regular "Open Folder" button.
- In `openDirectory` (the existing path), after a successful pick, call `saveFolderHandle(dirHandle)`.
- Do not clear the handle on tab close or unmount — the user would lose the auto-reopen they just earned. Clear only when a *new* folder is picked (overwrite via `saveFolderHandle`).

### Edge cases

- The folder no longer exists at restore time: `queryPermission` returns `'granted'` but `entries()` throws. Catch in the load path, fall back to the empty / "Open Folder" UI, and call `clearFolderHandle()`.
- IndexedDB unavailable (private browsing in some configurations): catch on `loadFolderHandle` / `saveFolderHandle` and behave as if no handle were stored.
- Browser lacks File System Access API: the existing code path already calls `window.showDirectoryPicker()` unconditionally; this feature does not change that, since the persisted handle is only relevant where the API exists.

### Tests

`src/lib/handleStore.test.ts` — round-trip a fake handle through the store, return null when empty, clear works.

`FileNavigator` is a UI component; per project convention it is not unit-tested. Manual browser test is the gate.

---

## File Map

**Add:**
- `src/hooks/useLayout.ts` + test
- `src/lib/handleStore.ts` + test

**Modify:**
- `src/App.tsx` — replace seven layout `useState` calls with `useLayout`.
- `src/hooks/useEditor.ts` + test — read/write `cobweb:editor:untitled`.
- `src/hooks/useReplConnection.ts` + test — auto-reconnect on mount, write `cobweb:lastDevice` on successful connect.
- `src/ReplInterface.ts` + test — add `getPortInfo()` and `static connectToPort(port)`.
- `src/components/FileNavigator.tsx` — load handle on mount, "Reopen" button when permission needs re-grant, save handle on pick.

---

## Phasing / Issue Breakdown

This feature ships behind the GitHub label `ui-state-persistence`. Each item below becomes a separate issue / PR.

1. **Layout persistence** — `useLayout` hook, wire into `App.tsx`. (independent)
2. **Untitled-buffer persistence** — read/write in `useEditor`. (independent)
3. **Auto-reconnect last device** — `ReplInterface.connectToPort`, `getPortInfo`, mount-time auto-reconnect in `useReplConnection`. (independent)
4. **Reopen last local folder** — `handleStore` IndexedDB module, mount-time load + "Reopen" button in `FileNavigator`. (independent)

All four are technically independent and can ship in any order.
