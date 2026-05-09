# Agent Tools — Technical Specification

## Overview

Four independent improvements to the coding harness. They share no dependencies and can be developed in any order or in parallel.

---

## 1. `stop_program` — interrupt tool + toolbar button

### `ReplInterface`

No changes required. The existing `send(data: string): void` path (used by `ReplShell` for user input) already accepts raw control characters.

### `ToolBindings` + `wireTools.ts`

Add `sendInterrupt: () => void` to the `ToolBindings` interface. Wire it in `wireTools()` to `() => send('\x03')`, where `send` is the same binding already passed from `useReplConnection` (exposed on `App.tsx` via `useReplConnection`). Add `sendInterrupt` to the bindings object in the `wireTools()` call in `App.tsx`.

### `StopProgramTool`

- `name: 'stop_program'`
- `scope: 'write'`
- `requiresApproval: false` — acceptance criterion is "without user intervention"
- Description: `"Sends a keyboard interrupt (Ctrl+C) to the connected device, stopping any running program and returning to the REPL prompt. Use this to stop a program started with run_editor or a snippet that is still running."`
- Args: `{}` (none)
- `call()`:
  1. `bindings.sendInterrupt()`
  2. Return `'Interrupt sent.'`

### `config.ts`

Add `'stop_program'` to the `tools` list. Add one sentence to `instructions`: "Use `stop_program` to send Ctrl+C and interrupt a running program."

### Toolbar

In `Toolbar.tsx`:
- Add `onStop: () => void` prop.
- Import `Square` from `lucide-react`.
- Add a Stop button immediately after the Run button, disabled when `!connected`. Use neutral styling (same as Reset), not primary.

In `App.tsx`:
- Pass `onStop={() => send('\x03')}` to `<Toolbar>`.

### File map

**Add:**
- `src/agent/tools/StopProgramTool.ts`
- `src/agent/tools/StopProgramTool.test.ts`

**Modify:**
- `src/agent/wireTools.ts` — add `sendInterrupt` to `ToolBindings`; register `StopProgramTool`
- `src/agent/config.ts` — add `'stop_program'` to tools list; add stop instruction
- `src/components/Toolbar.tsx` — add `onStop` prop + Stop button
- `src/App.tsx` — pass `onStop`; add `sendInterrupt` to `wireTools` call

---

## 2. `get_board_info` tool

Rather than probing the board at connect time and injecting the result into the system prompt, board information is exposed as a tool the agent can call on demand. This avoids connect-time latency and system prompt bloat for sessions where board context is never needed.

### Probe snippet

```python
import sys,gc,os;print(sys.implementation.name,sys.implementation.version,sys.platform,gc.mem_free());print(os.uname().machine)
```

Expected stdout (two lines):
```
micropython (1, 26, 0, '') rp2 7633920
Presto with RP2350
```

Line 1: firmware fields space-separated; version is a Python tuple repr. Line 2: machine name from `os.uname().machine` (may contain spaces).

### `GetBoardInfoTool` — `src/agent/tools/GetBoardInfoTool.ts`

**`ToolDefinition`:**
- `name: 'get_board_info'`
- `scope: 'read'`
- `requiresApproval: false`
- Description: `"Queries the connected MicroPython board for its firmware version, platform, and available RAM. Call this at the start of a session to understand what board you are working with."`
- Args: `{}` (none)

**`call()` body:**
1. Run the probe snippet via `bindings.runCode(PROBE_SNIPPET)` with a 5 s timeout.
2. If timeout → return `'Board info unavailable: probe timed out.'`
3. If `stderr` is non-empty → return `` `Board info unavailable: ${stderr.trim()}` ``
4. Split stdout by `\n`, trim and filter blank lines. Parse line 1 with `/^(\S+)\s+\(([^)]+)\)\s+(\S+)\s+(\d+)$/`:
   - `name` = group 1
   - `version` = group 2 split on `', '`, numeric parts only, joined with `.`
   - `platform` = group 3
   - `freeRamKb` = `Math.round(parseInt(group 4) / 1024)`
   - `machine` = line 2 if present, otherwise `undefined`
5. If line 1 parse fails → return `'Board info unavailable: unexpected probe output.'`
6. `boardLabel = machine ?? \`${name} on ${platform}\``
7. Return `` `Connected board: ${boardLabel} (${name} ${version}, free RAM: ~${freeRamKb} KB)` ``

**Timeout:** 5 000 ms (well below `ReplInterface.sendRaw`'s 30 s default).

### `config.ts` instructions update

Add `'get_board_info'` to the `tools` list. Add one sentence to `instructions`: `"Use get_board_info to learn the board's firmware version, platform, and available RAM before writing board-specific code."`

### Tests — `GetBoardInfoTool.test.ts`

- Both lines present → `'Connected board: Presto with RP2350 (micropython 1.26.0, free RAM: ~7455 KB)'`
- Machine line absent → falls back to `name on platform` in board label
- Malformed stdout → `'Board info unavailable: unexpected probe output.'`
- Empty stdout → `'Board info unavailable: unexpected probe output.'`
- Non-empty stderr → `'Board info unavailable: ...'`
- Timeout (fake timers, advance 5 000 ms) → `'Board info unavailable: probe timed out.'`
- Abort signal fires → rejects

### File map

**Add:**
- `src/agent/tools/GetBoardInfoTool.ts`
- `src/agent/tools/GetBoardInfoTool.test.ts`

**Modify:**
- `src/agent/wireTools.ts` — register `GetBoardInfoTool`
- `src/agent/config.ts` — add `'get_board_info'` to tools list; add instruction sentence

---

## 3. Convenience tools

### `OpenDeviceFileInEditorTool` (`open_device_file_in_editor`)

**Args:**
```ts
interface OpenDeviceFileInEditorArgs {
  path: string;  // absolute POSIX path on the device
}
```

**`ToolDefinition`:**
- `name: 'open_device_file_in_editor'`
- `scope: 'write'`
- `requiresApproval: true`
- Description: `"Reads a file from the device and loads it into the editor in one step. Use this instead of read_device_file + write_editor."`

**`call(args)` body:**
1. If `deviceFs === null` → `'Device is not connected.'`
2. `deviceFs.readBytes(path)` → decode UTF-8 fatal → on `TypeError` → `'Cannot open binary file in editor.'`
3. On `DeviceFsError` → return `err.message`
4. `setEditorContent(text)` → return `` `Editor opened ${path}.` ``

**Approval card:** Add `'open_device_file_in_editor'` to the write-card branch in `CobwebApproval`. The `WriteApprovalCard` receives the device file content (async read, same pattern as `write_device_file`) as the preview and uses heading "Open `<path>` in editor".

### `SaveEditorToDeviceTool` (`save_editor_to_device`)

**Args:**
```ts
interface SaveEditorToDeviceArgs {
  path: string;  // absolute POSIX path on the device
}
```

**`ToolDefinition`:**
- `name: 'save_editor_to_device'`
- `scope: 'write'`
- `requiresApproval: true`
- Description: `"Saves the current editor contents to a file on the device in one step. Use this instead of read_editor + write_device_file."`

**`call(args)` body:**
1. If `deviceFs === null` → `'Device is not connected.'`
2. `content = getEditorContent()`
3. `deviceFs.writeText(path, content)` → return `` `Editor saved to ${path}.` ``
4. On `DeviceFsError` → return `err.message`

**Approval card:** Add `'save_editor_to_device'` to the write-card branch in `CobwebApproval`. The `WriteApprovalCard` receives the editor content (synchronous) as the preview and uses heading "Save editor to `<path>`".

### `config.ts` instructions update

Add to `instructions`: "Use `open_device_file_in_editor` to open a device file in the editor in one step (instead of `read_device_file` + `write_editor`). Use `save_editor_to_device` to save the editor buffer to a device path in one step (instead of `read_editor` + `write_device_file`)."

### File map

**Add:**
- `src/agent/tools/OpenDeviceFileInEditorTool.ts`
- `src/agent/tools/OpenDeviceFileInEditorTool.test.ts`
- `src/agent/tools/SaveEditorToDeviceTool.ts`
- `src/agent/tools/SaveEditorToDeviceTool.test.ts`

**Modify:**
- `src/agent/wireTools.ts` — register both tools
- `src/agent/config.ts` — add both tool names; update instructions
- `src/components/CobwebApproval.tsx` — add both names to the write-card dispatch branch

---

## 4. Structured `run_snippet` output

### Exception patterns

MicroPython exceptions appear in `stderr`. Two patterns:

**Runtime error:**
```
Traceback (most recent call last):
  File "<stdin>", line N, in <module>
ExceptionType: message
```

**Syntax error:**
```
  File "<stdin>", line N
    bad code
    ^
SyntaxError: message
```

### `parseException` helper

Add `parseException(stderr: string): ExceptionInfo | null` inside `RunSnippetTool.ts`:

```ts
interface ExceptionInfo {
  type: string;
  message: string;
  line: number | null;
}
```

Logic:
1. Trim `stderr`. If it does not start with `Traceback` and does not match `  File "`, return `null`.
2. Last non-empty line → split on first `:` → `type` + `message`.
3. Find the last `line N` occurrence (from `File "...", line N` or `File "...", line N\n`) → parse `N` as `line`.

### Return format

When `parseException(stderr)` is non-null, `call()` returns a JSON string:
```json
{
  "stdout": "...",
  "exception": {
    "type": "ValueError",
    "message": "invalid value",
    "line": 3
  }
}
```

When no exception is detected, the existing plain-text format is preserved (backward compatible).

### Tests

Add or update `src/agent/tools/RunSnippetTool.test.ts`:
- No exception → plain text preserved
- Runtime exception → structured JSON with correct type, message, line
- Syntax error → structured JSON
- `stderr` with content that does not match either exception pattern → plain text
- Timeout path unaffected (still returns the "still running" string)

### File map

**Modify:**
- `src/agent/tools/RunSnippetTool.ts` — add `parseException`; update `call()` to return JSON when an exception is detected

---

## Issue breakdown

| Issue | Title | Files added | Files modified |
|-------|-------|-------------|----------------|
| A | `stop_program` tool + toolbar Stop button | `StopProgramTool.ts`, `.test.ts` | `wireTools.ts`, `config.ts`, `Toolbar.tsx`, `App.tsx` |
| B | `get_board_info` tool | `GetBoardInfoTool.ts`, `.test.ts` | `wireTools.ts`, `config.ts` |
| C | `open_device_file_in_editor` + `save_editor_to_device` | 4 tool + test files | `wireTools.ts`, `config.ts`, `CobwebApproval.tsx` |
| D | Structured `run_snippet` output | — | `RunSnippetTool.ts` |

All four issues are independent. No issue blocks another.
