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

## 2. Board context injection

### Probe snippet

Run once after connect (short timeout, e.g. 5 s):
```python
import sys,gc;print(sys.implementation.name,sys.implementation.version,sys.platform,gc.mem_free())
```

Expected stdout: `micropython (1, 23, 0, '') rp2 200000` (fields space-separated; version is a Python tuple repr).

### `BoardInfo` type

```ts
interface BoardInfo {
  name: string;      // e.g. "micropython"
  version: string;   // e.g. "1.23.0" (dots joined from tuple prefix)
  platform: string;  // e.g. "rp2"
  freeRam: number;   // bytes
}
```

### `probeBoard` utility — `src/agent/probeBoard.ts`

```ts
async function probeBoard(
  runCode: (code: string) => Promise<{ stdout: string; stderr: string }>
): Promise<BoardInfo | null>
```

Parses stdout by splitting on spaces and extracting fields. The version tuple `(1, 23, 0, '')` is parsed by stripping parens, splitting on `, `, taking numeric elements, and joining with `.`. Returns `null` on any parse failure, timeout, or non-empty stderr.

### Dynamic agent instructions — `config.ts`

Replace the `CODING_AGENT` constant with a `createCodingAgent(boardInfo?: BoardInfo | null)` factory function. When `boardInfo` is provided, prepend a one-line preamble to `instructions`:

```
Connected board: micropython 1.23.0 on rp2 (free RAM: ~195 KB)
```

`App.tsx` passes `createCodingAgent(boardInfo)` as the `agent` prop, memoised on `boardInfo`.

### `App.tsx` wiring

- Add `boardInfo` state: `const [boardInfo, setBoardInfo] = useState<BoardInfo | null>(null)`.
- `useEffect` on `connectionState`: when it becomes `'connected'`, call `probeBoard(runCode).then(setBoardInfo)`; when it becomes `'disconnected'`, call `setBoardInfo(null)`.
- `const agent = useMemo(() => createCodingAgent(boardInfo), [boardInfo])` — pass as `agent={agent}` to `<AgentProvider>`.

### File map

**Add:**
- `src/agent/probeBoard.ts`
- `src/agent/probeBoard.test.ts`

**Modify:**
- `src/agent/config.ts` — `CODING_AGENT` → `createCodingAgent(boardInfo?)` factory
- `src/App.tsx` — board probe effect; `boardInfo` state; memoised `agent`

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
| B | Board context injection | `probeBoard.ts`, `.test.ts` | `config.ts`, `App.tsx` |
| C | `open_device_file_in_editor` + `save_editor_to_device` | 4 tool + test files | `wireTools.ts`, `config.ts`, `CobwebApproval.tsx` |
| D | Structured `run_snippet` output | — | `RunSnippetTool.ts` |

All four issues are independent. No issue blocks another.
