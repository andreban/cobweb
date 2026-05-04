# Cobweb — Technical Specification

## Browser API Requirements

| API | Purpose | Availability |
|-----|---------|-------------|
| Web Serial API | Serial communication with microcontroller | Chromium-based browsers only |
| File System Access API | Opening local files into the editor | Chromium-based browsers only |
| Service Worker | PWA offline shell | All modern browsers |

## Component Architecture

### Entry Point

`src/main.ts` owns the application lifecycle:
- Initialises `ReplInterface`, `CodeEditor`, and the Lit components.
- Binds the Connect / Disconnect / Reset / Run buttons.
- Routes serial data from `ReplInterface` to `ReplShell`.

### Core Modules

#### `ReplInterface`

Wraps the Web Serial API and implements the MicroPython raw-REPL protocol.

- **Port config:** 115200 baud, 8 data bits, 1 stop bit, no parity, no flow control.
- **Raw mode entry:** sends Ctrl-A (`\x01`) to switch the device into raw REPL.
- **Code execution:** writes code bytes followed by Ctrl-D (`\x04`) to run.
- **Reset:** sends Ctrl-D in normal mode or calls `port.close()` + re-open sequence.
- **Output:** extends `EventTarget`; dispatches `'data'` events (`CustomEvent<Uint8Array>`) as bytes arrive from the device.
- **Async coordination:** uses `AsyncBlockingQueue<Uint8Array>` from `src/Queues.ts` to serialise reads from the underlying `ReadableStream`.
- **Write serialisation:** `send`, `sendRaw`, and `reset` are mutually exclusive end-to-end via an internal single-slot promise chain, so one caller's prologue cannot interleave with another's body in the underlying `WritableStream`. `disconnect` deliberately does not take this lock — it relies on `WritableStreamDefaultWriter.close()` to flush queued chunks.
- **Raw-REPL response parsing:** `sendRaw(code, timeoutMs?)` returns `Promise<{stdout: string, stderr: string}>`. While a call is in flight, the read loop also feeds incoming bytes to an internal state machine that walks the protocol phases (banner → handshake → [paste streaming | plain `OK`] → stdout → `\x04` → stderr → `\x04`) and resolves after the second `\x04`. The `'data'` event is still fired with the full byte stream so the xterm mirror is unaffected. On timeout (default 30 s) or device disconnect, the call rejects; the `Ctrl-B` epilogue is sent best-effort either way so the device leaves raw mode.
- **Raw-paste mode:** after the banner, `sendRaw` writes the raw-paste request `\x05A\x01` and inspects the device's reply: `R\x00` falls back to plain raw mode (each line written CR-terminated, then `Ctrl-D`); `R\x01<window-lo><window-hi>` starts raw-paste streaming. In paste mode, source bytes are written verbatim in chunks no larger than the device's flow-controlled window, refilled by `\x01` bytes from the device. A device-sent `\x04` (abort) stops streaming; the host still writes end-of-data `\x04` so the device leaves paste mode cleanly and surfaces the failure reason in stderr.
- **Device-lost handling:** an internal `disconnected` flag flips to `true` when the read loop ends (any reason), `disconnect()` is called, or any write rejects mid-call. Once set, `reset`, `send`, and `sendRaw` reject with the exported `ReplDisconnectedError` (the original underlying error, when there is one, is preserved on `cause`) instead of letting raw stream errors (`UnknownError`, `NetworkError`, `TypeError: Cannot close a ERRORED writable stream`, …) escape. `disconnect()` itself tolerates an already-errored writer/reader/port by catching each step and falling back to `releaseLock`. `useReplConnection` swallows `ReplDisconnectedError` from `reset`/`send`/`disconnect` so post-loss user clicks don't surface as unhandled rejections; `runCode` propagates rejections so callers can surface them.

#### `CodeEditor`

Wraps CodeMirror 6.

- Extensions loaded: `python()` language, `basicSetup`, `oneDark` theme.
- Public API: `getContent(): string`, `setContent(code: string): void`.
- Mounted into a `<div id="editor">` in `index.html`.

#### `src/Queues.ts`

- `Queue<T>` — synchronous FIFO.
- `AsyncBlockingQueue<T>` — async FIFO; `dequeue()` returns a `Promise<T>` that resolves when an item is available. Used by `ReplInterface` to bridge the Web Serial `ReadableStream` reader loop and callers awaiting specific response bytes.

### Lit Web Components (`src/components/`)

#### `SplitPane` (`<split-pane>`)

- Attributes: `direction` (`horizontal` | `vertical`), `initialSize` (CSS length for the first slot).
- Renders two `<slot>` elements separated by a draggable divider.
- Handles `pointerdown` / `pointermove` / `pointerup` for drag; `touchstart` / `touchmove` / `touchend` for touch.
- Dispatches no custom events; layout is purely internal.

#### `ReplShell` (`<repl-shell>`)

- Wraps `xterm.js` (`Terminal`) with the `FitAddon`.
- Public method: `appendText(data: Uint8Array): void` — writes raw bytes to the terminal (supports ANSI escape codes).
- `clear(): void` — clears the terminal buffer.
- Resizes the xterm instance when the host element resizes (`ResizeObserver`).

#### `FileNavigator` (`<file-navigator>`)

- Uses `window.showOpenFilePicker()` (File System Access API) to let the user pick a `.py` file.
- Dispatches a `'file-selected'` custom event with the file's text content.
- `main.ts` handles this event to call `editor.setContent(text)`.

## Build Pipeline

- **Bundler:** Vite 6.x (Rollup-based, esbuild for transforms)
- **Entry point:** `index.html` at repo root references `src/main.ts` as a module script
- **Static assets:** `public/` directory (manifest, icons, service worker) — served at `/` in dev, copied to `dist/` on build
- **Output:** `dist/` — `index.html` + hashed JS bundle
- **Dev server:** `npm run dev` → `http://localhost:5173` with HMR

## Feature Subdirectory Docs

Sub-feature docs go in a subdirectory under `docs/` with their own `PRD.md` and `SPEC.md`. When a feature is complete, move its subdirectory to `docs/archive/`. Do not rewrite or restructure files in `docs/archive/`.
