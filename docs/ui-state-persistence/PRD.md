# UI State Persistence — Product Requirements Document

## Problem Statement

Cobweb resets to a blank state on every page reload. The agent conversation, theme preference, and provider config already persist (see `cobweb:conversation`, `cobweb:theme`, `cobweb:provider-config` in localStorage), but everything else — split-pane sizes, panel visibility, the untitled editor buffer, the connected device, and the open local folder — is in-memory only.

Each reload forces the user to: re-arrange the panes, re-open their folder via `showDirectoryPicker`, re-click "Connect" and re-pick the same serial port from the browser chooser, and lose any work-in-progress in an untitled buffer. For a tool people leave open across many short sessions (workshop, classroom, hobby tinkering), that friction is the difference between "still where I left off" and "start from scratch every time."

## Target Users

Same as the parent PRD — educators, hobbyists, beginners. The persistence behaviour matters most for:

- **Hobbyist** opens Cobweb, wires a script for their Pico, gets pulled away, closes the tab. Returns hours later: their layout, last folder, last device, and unsaved scratch buffer should all still be there.
- **Educator** sets up a workshop environment (panel layout, default folder), then duplicates the tab on each student's machine. Reload should not undo that setup.

## Goals

1. **Layout persists.** Split-pane sizes and the open/closed state of the left, REPL, and right panels survive reload.
2. **Untitled buffer persists.** Text the user has typed into a buffer with no file origin is restored on reload.
3. **Last device auto-reconnects.** If the browser still has permission for the previously-connected serial port (matched by USB vendor + product ID), reconnect silently on load.
4. **Last local folder reopens.** The handle to the previously-opened local folder is remembered. On load, attempt to reopen silently; if the browser requires a permission re-grant, surface a one-click "Reopen <foldername>" button.

## Out of Scope

- **Editor cursor / scroll position.** Restoring cursor or viewport state across reloads. Buffer content is enough for v1.
- **Editor origin restore for local / device files.** Local-file handles that live inside the open folder are not individually re-opened. Device-file origins are not restored (the device may have changed). Only `untitled` is persisted.
- **REPL scrollback.** Terminal output is tied to the live device session; we do not replay it.
- **File-navigator expansion state.** Folder paths may be stale; users re-expand on demand.
- **Multi-device memory.** Only the last connected device is remembered; we do not maintain a list.
- **Cross-browser sync.** Persisted state lives in this browser's localStorage / IndexedDB; we do not sync across devices or profiles.

## Success Criteria

- Resize a split, toggle the right panel closed, reload — split size and panel state are restored.
- Type into an untitled buffer, reload — text is back.
- Connect to a Pico, reload — connection state shows "connected" within ~1s without the user clicking Connect or seeing a serial-port chooser.
- Open a local folder, reload — the folder's contents appear in the file navigator without a click. If the browser requires re-grant, a "Reopen <foldername>" button appears in the navigator header and one click restores it.
- A reload with no previously-connected device and no previously-opened folder behaves identically to a first-time visit (no errors in console, no spurious UI).
- Existing persisted state (`cobweb:conversation`, `cobweb:theme`, `cobweb:provider-config`) is unaffected.
