# Device Files — Technical Specification

## Overview

Device-filesystem operations are implemented as small MicroPython snippets executed via `ReplInterface.sendRaw`. Each snippet prints a parseable result to stdout and we read `RunResult.stdout`. Binary content crosses the wire as base64 to keep transfers text-clean. No state is stored on the device — every operation ships its own helper code inline. The serial write chain in `ReplInterface` already serialises calls, so concurrent UI actions queue cleanly behind one another.

A new `DeviceFs` model wraps these snippets behind a typed API. A `useDeviceFs` hook owns its lifecycle and React state. A new `<DeviceFileNavigator>` component renders the tree. The existing `<FileNavigator>` is unchanged; the left pane gains a vertical split between the two.

---

## Device-side Protocol

All operations enter raw REPL via `ReplInterface.sendRaw(code)`. This means **every device-fs call interrupts any running program on the board** — same as clicking Run today. The UI surfaces this clearly (see "Busy state" below). We do not silently re-run interrupted programs.

### Path semantics

- Paths are absolute, POSIX-style, starting with `/` (e.g. `/lib/picozero.py`).
- The root is always `/`.
- Path utilities live in `src/lib/devicePath.ts`: `join(base, ...parts)`, `dirname(p)`, `basename(p)`, `normalise(p)`, `validateName(name)`. No external dependency.

### Name validation (`validateName`)

Used by the create-file, create-directory, and rename inline inputs before any device call is made.

```ts
type NameValidation = { ok: true } | { ok: false; reason: string };
export function validateName(name: string): NameValidation;
```

Rejects:
- Empty string or whitespace-only.
- Embedded `/` (paths only, names can't span directories).
- `.` or `..` (would resolve to parent / current dir).
- Control characters (`\x00`–`\x1f`, `\x7f`).
- Names longer than 255 bytes after UTF-8 encoding (typical filesystem limit; FAT-style filesystems on Pico further restrict, but device-side rejection is acceptable for those edge cases — host-side covers the common case).

Each rejection returns a `reason` suitable for inline error display ("Name cannot contain '/'", etc.). The component shows the reason next to the input and disables the confirm action until the name is valid.

### Snippet conventions

Every snippet:
- Imports only modules guaranteed by stock MicroPython (`os`, `binascii`, `json`).
- Prints a single line of `json.dumps` output, which `JSON.parse` consumes directly host-side.
- Wraps the work in `try/except` and prints `ERR:<message>` on failure so the host can surface it.
- Uses no helper functions on the device.

### Operations

| Operation | Args (host) | Snippet (sketch) | Returns |
|-----------|-------------|------------------|---------|
| `list(path)` | path: string | `import os, json; r = [{'name': n, 'isDir': (os.stat(path+'/'+n)[0] & 0x4000) != 0} for n in os.listdir(path)]; print(json.dumps(r))` | `Array<{ name: string; isDir: boolean }>` |
| `stat(path)` | path: string | `import os, json; s = os.stat(path); print(json.dumps({'isDir': (s[0] & 0x4000) != 0, 'size': s[6]}))` | `{ isDir: boolean; size: number }` |
| `readBytes(path)` | path: string | `import binascii; f = open(path, 'rb'); print(binascii.b2a_base64(f.read()).decode().strip()); f.close()` | `Uint8Array` |
| `writeBytes(path, bytes)` | path: string, bytes: Uint8Array | `import binascii; f = open(path, 'wb'); f.write(binascii.a2b_base64(b'<base64>')); f.close()` | `void` |
| `mkdir(path)` | path: string | `import os; os.mkdir(path)` | `void` |
| `rename(from, to)` | from: string, to: string | `import os; os.rename(from, to)` | `void` |
| `removeFile(path)` | path: string | `import os; os.remove(path)` | `void` |
| `removeDir(path)` | path: string | `import os; os.rmdir(path)` (must be empty) | `void` |

For the file-content operations, the host inserts the path / payload as a Python string literal using a safe escaping helper (`escapePythonStr` in `src/lib/devicePath.ts`) — backslash and quote escaping only, no expression interpolation. Base64 strings are ASCII so they are inserted as `b'...'` byte literals without escaping concerns.

### Result parsing

The host receives `RunResult.stdout`. After trimming, the first non-empty line is the result. If it starts with `ERR:`, throw `DeviceFsError(message)`. Otherwise:

- **List / stat results:** `JSON.parse` the line directly. The device emits `json.dumps` output, so filenames with quotes, backslashes, or non-ASCII characters round-trip correctly. `json` is part of stock MicroPython on every port Cobweb targets.
- **Read result:** raw base64 line, decoded with `atob` + `Uint8Array`. Reject if it doesn't decode.
- **Other operations:** stdout is empty on success.

### Size limits

- **Reads:** the device prints base64 to stdout; large files mean large base64 strings buffered in `RunResult.stdout`. We refuse reads where `os.stat` reports `> 256 KiB`. The error surfaces in the UI as "File too large to open."
- **Writes:** same 256 KiB limit on the source bytes, enforced host-side. (The device-side write itself is fine; the limit is to avoid pathological transfer times.)
- **List:** no explicit limit. Directories with thousands of entries will be slow but work.

These limits live as named constants in `DeviceFs` (`MAX_READ_BYTES`, `MAX_WRITE_BYTES`).

### Binary safety for editor opens

When the user clicks a device file, we call `readBytes`, then attempt `new TextDecoder('utf-8', { fatal: true }).decode(bytes)`. On `TypeError` we surface "binary file — cannot open in editor" and do not change the editor content.

---

## Models

### `DeviceFs` (`src/DeviceFs.ts`)

```ts
export interface DeviceDirEntry {
  name: string;
  isDir: boolean;
}

export class DeviceFsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeviceFsError';
  }
}

export class DeviceFs {
  constructor(private runRaw: (code: string) => Promise<RunResult>) {}

  list(path: string): Promise<DeviceDirEntry[]>;
  stat(path: string): Promise<{ isDir: boolean; size: number }>;
  readBytes(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;        // helper: readBytes + UTF-8 decode (fatal)
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;          // device-side requires empty; host walks for recursive
}
```

`runRaw` is the existing `ReplInterface.sendRaw`. `DeviceFs` does not own a `ReplInterface` — it takes the bound function so it can be created and torn down with the connection. `DeviceFs` is therefore null when disconnected; `useDeviceFs` constructs and discards it accordingly.

Errors propagate as:
- `DeviceFsError` for device-reported errors (caught from `ERR:` lines).
- `ReplDisconnectedError` (re-thrown unchanged) for connection loss.
- `Error` for protocol violations (unparseable output, oversized file).

---

## ViewModel — `useDeviceFs(replConnection)`

Lives in `src/hooks/useDeviceFs.ts`. Consumes the existing `useReplConnection` return value (specifically `runCode` — note this currently calls `sendRaw`; we extend `useReplConnection` to expose `sendRaw` directly under that name, see "Hook integration" below).

```ts
{
  isAvailable: boolean,                      // true when connectionState === 'connected'
  tree: DeviceTreeNode | null,               // expandable tree state
  expand(path: string): Promise<void>,       // populate children of a directory
  collapse(path: string): void,
  refresh(path: string): Promise<void>,      // re-list a directory
  refreshAll(): Promise<void>,               // re-list every currently-expanded directory
  readText(path: string): Promise<string>,
  writeText(path: string, text: string): Promise<void>,
  writeBytes(path: string, bytes: Uint8Array): Promise<void>,
  readBytes(path: string): Promise<Uint8Array>,
  mkdir(path: string): Promise<void>,
  rename(from: string, to: string): Promise<void>,
  removeFile(path: string): Promise<void>,
  removeDir(path: string, opts?: { recursive?: boolean }): Promise<void>,
  busy: boolean,                             // true while a device-fs op is in flight
  lastError: DeviceFsError | Error | null,
}
```

### Mutation → tree refresh

Every successful mutation triggers a refresh of the affected directory before returning, so the tree stays in sync without callers having to remember:

- `writeText` / `writeBytes` → `refresh(dirname(path))`
- `mkdir` → `refresh(dirname(path))`
- `rename` → `refresh(dirname(from))` and, if different, `refresh(dirname(to))`
- `removeFile` / `removeDir` → `refresh(dirname(path))`

If the affected directory is not currently expanded in the tree, the refresh is skipped (no point listing a folder the user isn't looking at). Refresh failures do not fail the mutation — the mutation already succeeded; the refresh is best-effort and surfaces via `lastError` only if the user happens to look.

### Recursive directory delete

`removeDir(path, { recursive: false })` (the default) calls `DeviceFs.removeDir` directly and surfaces the device's "directory not empty" error if applicable.

`removeDir(path, { recursive: true })` walks host-side: list the directory, recurse into subdirectories, `removeFile` each file, then `removeDir` the now-empty directory bottom-up. Host-side walk is preferred over a single device-side recursive snippet because (a) it shares one error surface with the rest of `DeviceFs`, (b) progress is observable per-step (we can update `busy` / status text), and (c) it avoids constructing a multi-line snippet on the device.

The `<DeviceFileNavigator>` Delete action:
1. Calls `stat(path)` to detect whether the target is a file or directory.
2. For a file → confirm "Delete X?" → `removeFile`.
3. For an empty directory → confirm "Delete X?" → `removeDir(path)`.
4. For a non-empty directory → confirm "Delete X and N item(s) inside?" with item count from a quick `list` → `removeDir(path, { recursive: true })`.

The N-item count is for the immediate children only (no full recursive count); the wording is chosen to avoid implying the count is recursive.

### Tree state shape

```ts
interface DeviceTreeNode {
  path: string;                  // absolute, e.g. '/lib'
  name: string;                  // basename, e.g. 'lib' (or '/' for root)
  isDir: true;
  expanded: boolean;
  children: DeviceTreeEntry[];   // empty until expanded
}

interface DeviceTreeFile {
  path: string;
  name: string;
  isDir: false;
}

type DeviceTreeEntry = DeviceTreeNode | DeviceTreeFile;
```

The hook holds a single root node `{ path: '/', expanded: true, ... }`. Children are loaded lazily on `expand`. `refresh(path)` re-lists a single node and merges; child expansion state for surviving subtrees is preserved.

### Lifecycle

- On `connectionState` becoming `'connected'`, build a new `DeviceFs` instance and auto-expand the root.
- On `connectionState` becoming `'disconnected'`, set `tree` to `null` and discard the `DeviceFs` instance.

### Busy / error reporting

`busy` flips to `true` for the duration of any in-flight `DeviceFs` call. `lastError` is set on failure and cleared by the next successful op. The UI uses these to disable interaction during ops and to surface a toast / inline message on failure.

---

## Hook integration

`useReplConnection` already exposes `runCode(code)` which calls `ReplInterface.sendRaw`. Rather than overload the meaning of `runCode` ("run user code"), add a sibling export `sendRaw(code)` with an identical implementation. `useDeviceFs` consumes `sendRaw`. `runCode` remains for the existing Run button and agent tools.

```ts
// useReplConnection return type — additions
{
  ...,
  sendRaw(code: string): Promise<RunResult>,   // alias for runCode, semantically distinct caller
}
```

Both routes through the same `replRef.current.sendRaw`, so write-chain serialisation handles concurrency between user-Run and device-fs ops automatically.

---

## Editor origin tracking

`useEditor` gains an "origin" concept so Save knows where to write.

```ts
type EditorOrigin =
  | { kind: 'untitled' }
  | { kind: 'local'; handle: FileSystemFileHandle; name: string }
  | { kind: 'device'; path: string };

// useEditor additions
{
  ...,
  origin: EditorOrigin,
  setOriginAndContent(origin: EditorOrigin, content: string): void,  // atomic
  isModified: boolean,
}
```

`isModified` compares the editor's current content to a snapshot taken at last open / save. Writing back via Save updates the snapshot.

The Toolbar gains a Save button (`Ctrl+S` / `Cmd+S`):
- `origin.kind === 'device'` → `deviceFs.writeText(origin.path, getContent())`.
- `origin.kind === 'local'` → write through `FileSystemFileHandle.createWritable()`.
- `origin.kind === 'untitled'` → opens a "Save to…" prompt: device path, or local file picker.

A modified buffer + an attempt to open a different file triggers a confirm dialog ("Discard unsaved changes?").

---

## UI

### Layout

The existing left pane (`<FileNavigator>`) becomes the top half of a vertical `<SplitPane>`. The bottom half is `<DeviceFileNavigator>`. Both panels render as lazy expandable trees so navigation feels symmetric and drag-and-drop targets are uniform.

```
<SplitPane horizontal initialSize={leftSize}>          ← unchanged outer layout
  <SplitPane vertical initialSize={50}>                ← NEW
    <FileNavigator />                                  ← upgraded to tree
    <DeviceFileNavigator />                            ← NEW
  </SplitPane>
  <SplitPane horizontal …>                             ← unchanged
    …
  </SplitPane>
</SplitPane>
```

### `<DeviceFileNavigator>` (`src/components/DeviceFileNavigator.tsx`)

Props:
```ts
{
  isAvailable: boolean,
  tree: DeviceTreeNode | null,
  busy: boolean,
  onExpand: (path: string) => void,
  onCollapse: (path: string) => void,
  onRefresh: (path: string) => void,
  onOpenFile: (path: string) => void,           // editor open
  onCreateFile: (parentPath: string) => void,   // opens inline name input
  onCreateDir: (parentPath: string) => void,
  onRename: (path: string, newName: string) => void,
  onDelete: (path: string) => void,
  onUpload: (parentPath: string, file: File) => void,        // local→device drag drop
  onDownloadRequest: (path: string) => Promise<Uint8Array>,  // device→local drag drop
}
```

Visual:
- Header: "Device Files" + a small spinner when `busy`. Refresh button (rotates root + every expanded subtree).
- When `!isAvailable`: empty state — "Connect a device to browse its files."
- Tree rows: chevron + folder/file icon (lucide `ChevronRight` / `Folder` / `File`) + name. Clicking a folder toggles expand. Clicking a file fires `onOpenFile`.
- Hover row → action icons (`Plus` to create-in-folder, `Pencil` for rename, `Trash` for delete).
- Right-click → context menu with the same actions plus "Refresh" and "Download" (file) / "Upload here" (folder).
- Drag source: file rows are draggable (`draggable={true}`), the drag payload carries `application/x-cobweb-device-path` with the path. Drop target: folders accept drops of (a) browser `File` objects (local-FS files) and (b) `application/x-cobweb-local-path` (drag from `<FileNavigator>` — which we extend to set this MIME).
- All destructive actions (rename, delete) confirm via a small inline confirmation, not a modal.

### `<FileNavigator>` updates

The local navigator is upgraded from its current flat list to a lazy tree, mirroring `<DeviceFileNavigator>`'s state model and rendering. This is a precondition for the device work — symmetric panes make drag-and-drop semantics uniform — but ships as its own PR (foundations issue) since it is independently useful.

**Tree state (component-local `useState`):**

```ts
interface LocalTreeNode {
  handle: FileSystemDirectoryHandle;
  name: string;
  isDir: true;
  expanded: boolean;
  children: LocalTreeEntry[];   // empty until expanded
}

interface LocalTreeFile {
  handle: FileSystemFileHandle;
  name: string;
  isDir: false;
}

type LocalTreeEntry = LocalTreeNode | LocalTreeFile;
```

The root is the directory the user picks via `showDirectoryPicker()`. Children load lazily on expand by iterating `dirHandle.entries()`. Rendering is identical in shape to the device tree (chevron + icon + name; clicking a folder toggles expand; clicking a file fires `onFileSelected`). The two navigators do not share a component for v1 — they have different state sources (file-system handles vs paths) and different action sets — but rendering looks identical so a shared `<TreeView>` extraction is a reasonable v2 cleanup if a third tree appears.

**Drag/drop additions:**

- Add `draggable={true}` to file rows; on `dragstart`, set `application/x-cobweb-local-path` with the file's `name` and a stable handle ID. Because `FileSystemFileHandle` cannot be moved through drag payload, the local navigator keeps a small `dragSourceMap: Map<string, FileSystemFileHandle>` keyed by the ID it generated.
- Add a drop zone that accepts the `application/x-cobweb-device-path` MIME → triggers download (host fetches bytes via `deviceFs.readBytes`, writes to a new file in the open local folder via `dirHandle.getFileHandle(name, { create: true })` → `createWritable()`).
- Drop-onto-file falls through to the file's parent directory.

### Drag-and-drop semantics

Source → Target:
- **Local → Device folder** (browser `File` from drag, or our local-handle drag): host calls `deviceFs.writeBytes(target/name, bytes)`. If a file with that name exists, prompt to overwrite.
- **Device file → Local pane**: host fetches bytes with `deviceFs.readBytes`, then writes via the open `dirHandle.getFileHandle(name, { create: true })` → `createWritable()`. If no local folder is open, show an error toast: "Open a local folder first."
- **Device → Device folder** (move within device): host calls `deviceFs.rename(from, to)`. Skipped if the user drops onto the same parent.

Cross-filesystem drags use the MIME type as a discriminator. Files dragged in from the OS desktop use the standard `dataTransfer.files` and are treated like a local-source upload.

**Folder drags are refused for v1.** If `dataTransfer` exposes a directory entry (`webkitGetAsEntry().isDirectory`), or if the user drags a folder row from either navigator, the drop is rejected with a toast: "Folder upload/download is not supported yet — drag individual files for now." Recursive folder transfer is a v2 feature; the surface area (size accounting, partial failure recovery, per-entry name-collision prompts) is wider than it appears and we'd rather ship the file path solidly first.

**Drop-onto-file** falls through to the file's parent folder. Visually, dragging over a file row highlights its parent (not the file itself) so the target is unambiguous before release.

### Busy state

While `useDeviceFs.busy` is true:
- Tree rows remain clickable but show a subdued cursor; subsequent ops queue (the underlying `sendRaw` already serialises).
- The Run button does **not** disable — the user can still queue a code run; it'll execute after the device-fs op finishes. We document this plainly. Long-running programs already block raw mode, and entering raw mode interrupts them; users should not start file ops while expecting a long-running program to keep executing. The Toolbar surfaces a one-line tip when both are in flight.

### Unsaved-changes confirmation

When the user activates a different file (clicking another file, opening a local file via the local picker) and the editor `isModified` is true, show a small inline confirmation in the Toolbar / editor area: "Unsaved changes — Save / Discard / Cancel."

---

## Agent Tools

New tools wired through `wireTools` so the agent can manipulate the device filesystem on the user's behalf. Mirrors the existing `RunSnippetTool` shape.

| Tool | Scope | Approval | Args | Returns |
|------|-------|----------|------|---------|
| `list_device_files` | read | no | `{ path?: string }` (defaults to `/`) | newline-joined `name` (with `/` suffix for dirs) |
| `read_device_file` | read | no | `{ path: string }` | file text (UTF-8); error string on binary |
| `write_device_file` | write | yes | `{ path: string; content: string }` | `'ok'` |
| `delete_device_file` | write | yes | `{ path: string }` | `'ok'` |
| `make_device_dir` | write | yes | `{ path: string }` | `'ok'` |

Rename is omitted from agent tools for v1 (it's rarely a useful agent action and reduces approval noise).

`ToolBindings` (in `wireTools.ts`) gains a `deviceFs: DeviceFs | null` field. Tools no-op with a clear error message when `deviceFs === null` ("device is not connected").

`CODING_AGENT.tools` adds the new tool names. Instructions update with one paragraph: "You can also read and write files on the connected device. Use list_device_files to discover what's there, read_device_file to inspect a file, and write_device_file when the user asks to save code to the device. Always prefer write_editor for buffers the user is iterating on; only write to the device when explicitly asked or when the change is meant to persist (e.g. main.py, boot.py)."

---

## File Map

**Add:**
- `src/DeviceFs.ts`
- `src/lib/devicePath.ts`
- `src/hooks/useDeviceFs.ts`
- `src/components/DeviceFileNavigator.tsx`
- `src/components/EditorBanner.tsx` — inline strip for unsaved-changes confirmation and device-open errors.
- `src/agent/tools/ListDeviceFilesTool.ts`
- `src/agent/tools/ReadDeviceFileTool.ts`
- `src/agent/tools/WriteDeviceFileTool.ts`
- `src/agent/tools/DeleteDeviceFileTool.ts`
- `src/agent/tools/MakeDeviceDirTool.ts`

**Modify:**
- `src/hooks/useReplConnection.ts` — expose `sendRaw` alias.
- `src/hooks/useEditor.ts` — add `origin`, `setOriginAndContent`, `isModified`.
- `src/components/FileNavigator.tsx` — convert flat list to lazy tree; make rows draggable; accept device-file drops.
- `src/components/Toolbar.tsx` — add Save button + keyboard shortcut.
- `src/App.tsx` — wire `useDeviceFs`, embed `<DeviceFileNavigator>` in a vertical split with `<FileNavigator>`, pass `deviceFs` into `wireTools`.
- `src/agent/wireTools.ts` — extend `ToolBindings` with `deviceFs`, register new tools.
- `src/agent/config.ts` — add tool names + instruction paragraph.

**Tests (Vitest, alongside source):**
- `src/DeviceFs.test.ts` — mock `runRaw`, verify each operation's snippet shape and result parsing, including error cases.
- `src/lib/devicePath.test.ts` — path helpers and `validateName`: edge cases (`/`, double slashes, `.`/`..` rejection, empty names, embedded slashes, control chars, length limit).
- `src/hooks/useDeviceFs.test.ts` — tree expansion, refresh merging, busy state, lifecycle on disconnect.
- `src/agent/tools/*.test.ts` — one per tool, mocking `DeviceFs`.

UI components are not unit-tested per project convention; they will be exercised via manual browser testing before merge.

---

## Phasing / Issue Breakdown

This feature ships behind the GitHub label `device-files`. Each item below becomes a separate issue / PR. Default is many small PRs; consolidate only when two items genuinely cannot be reviewed independently.

**Foundations (no UI, except #5 which is pure local-FS):**
1. `devicePath` helpers + tests.
2. `DeviceFs` model + tests (depends on #1).
3. `useReplConnection.sendRaw` alias.
4. `useDeviceFs` hook + tests (depends on #2, #3).
5. `<FileNavigator>` upgraded from flat list to lazy tree (independent of device work; can ship on its own).

**Editor origin tracking:**
6. `useEditor` adds `origin`, `isModified`, `setOriginAndContent` + tests.
7. Toolbar Save button + `Ctrl+S` shortcut, wired for `origin.kind === 'local'` and the untitled "save to local file" prompt (depends on #6).

**Read-only device navigator:**
8. Vertical split in the left pane; empty `<DeviceFileNavigator>` placeholder mounted.
9. `<DeviceFileNavigator>` renders the tree: list, expand/collapse, refresh button (depends on #4, #8).
10. Click a device file → load into editor with `origin.kind === 'device'`; Save writes back via `deviceFs.writeText` (depends on #6, #7, #9).

**Device-side mutations (one per action; all use `validateName` host-side before dispatch and call the affected directory's `refresh` on success):**
11. Create new file in folder.
12. Create new directory.
13. Rename.
14. Delete file / empty directory (with inline confirmation).
15. Recursive directory delete (host-side walk; "Delete X and N item(s) inside?" confirm; depends on #14).

**Cross-filesystem transfer (one per direction; folder drags refused with toast):**
16. Local → Device upload (drag-and-drop + right-click "Upload here").
17. Device → Local download (drag-and-drop + right-click "Download").
18. Device → Device move (drag-and-drop within device).

**Agent tools (one per tool):**
19. `list_device_files`.
20. `read_device_file`.
21. `write_device_file`.
22. `delete_device_file`.
23. `make_device_dir`.

Each issue's body should reference the relevant section of this SPEC by heading. State `Depends on #N` for any explicit dependency so the implementation order is clear; un-numbered items within a group are independent and can be done in parallel.

---

## Open Questions

- **Selectable storage root.** Devices with SD cards mount the card under a subdirectory (often `/sd`). For v1 we surface whatever `os.listdir('/')` returns; users see the SD card as a folder under root. Multi-mount UX is deferred.
- **Per-folder Open Folder / handle persistence.** Local-folder handle is currently lost on reload. Out of scope for this feature, but worth re-evaluating for the upload-path UX.
- **Atomic writes.** Currently `writeBytes` is a single open-write-close. If the connection drops mid-write, the file is truncated. Atomic-rename pattern (write to `path.tmp` then `os.rename`) is a v2 improvement if reports come in.
