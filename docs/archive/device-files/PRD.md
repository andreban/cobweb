# Device Files — Product Requirements Document

## Problem Statement

Cobweb today lets users open files from their local computer, edit them, and run them on the connected microcontroller. It cannot, however, browse, edit, or manage the files that live on the device itself — `main.py`, `boot.py`, library modules, configuration files, datasets. The only way to inspect or change those files in Cobweb today is to type `os.listdir()` / `open(...).read()` / `open(...,'w').write(...)` snippets into the REPL, which is fragile, error-prone, and not what users coming from Thonny, Mu, or `mpremote` expect.

For real MicroPython workflows — shipping a `main.py` so the program runs on power-up, dropping a vendor library next to it, deleting a stale data file — direct device-filesystem access is essential. Now that raw-paste mode is in place (`docs/repl-improvements`), we can transfer arbitrary bytes (including binary file contents) over the serial link reliably, which unblocks this feature.

## Target Users

Same as the parent PRD (educators, hobbyists, beginners). Two scenarios this feature unlocks:

- **Educator** prepares a starter `main.py` and a few helper modules locally, then drags them onto the device pane during a workshop so every student board boots into the demo.
- **Hobbyist** edits `boot.py` directly on the device to set Wi-Fi credentials, without ever touching their local filesystem.

## Goals

1. **Device file tree.** Show a navigable, expandable tree of files and directories on the device, rooted at `/`.
2. **Edit-in-place.** Opening a device file loads it into the editor; saving writes back to the device. There is no shadow local copy. The editor tracks the origin (local file, device file, or untitled) and Save targets that origin.
3. **Full CRUD.** Users can create files, create directories, rename, and delete (files and empty directories) on the device, all without dropping into the REPL.
4. **Cross-filesystem transfer.** Users can move files between local and device by drag-and-drop and by right-click menu. Both directions: upload (local → device) and download (device → local).
5. **Familiar layout.** The left pane splits vertically: "This Computer" (top) and "Device Files" (bottom). Both visible at once and both rendered as expandable lazy-loaded trees so navigation feels symmetric. Mirrors Thonny's layout. The existing `<FileNavigator>`'s flat-list rendering is upgraded to a tree as part of this work.
6. **Unsaved-changes indicator.** The editor shows when the open buffer differs from its origin file, and warns before discarding changes.

## Out of Scope

- **Concurrent edits.** One file open in the editor at a time. No tabs.
- **Binary file editing.** Binary files can be uploaded, downloaded, and deleted, but opening one in the editor is undefined (best-effort: refuse to open if not valid UTF-8).
- **Diff or sync.** No comparison between local and device versions, no automatic mirroring.
- **Multi-board file management.** One connected device per session.
- **File search across the device.** No grep / find.
- **Filesystem mount management.** `os.mount` / SD-card slots are not exposed; whatever the device's working filesystem reports is what we show.
- **Operations during a long-running program.** File operations require entering raw REPL, which interrupts running code. We document this rather than work around it (see SPEC).

## Success Criteria

- A user with a Pico connected can expand `/` in the Device Files panel, click `main.py`, edit it, press Save, and the change persists across a hard reset.
- Creating a new file, creating a subdirectory, renaming a file, and deleting a file all complete end-to-end through the UI.
- Dragging `app.py` from the This Computer panel onto a device folder uploads it. Dragging `boot.py` from the device onto the This Computer panel writes it into the user's currently-open local folder.
- The editor surfaces a clear "modified" indicator and prompts before discarding unsaved changes when the user opens a different file.
- A non-UTF-8 device file shows in the tree but cannot be opened in the editor — the user gets an explicit "binary file" message instead of garbled text.
- All operations work on a Raspberry Pi Pico W with stock MicroPython (1.20+).
