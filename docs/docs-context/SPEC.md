# MicroPython Documentation and Board-Specific Context Injection — Technical Specification

## Overview

The PRD identifies three primitives for phase 1: per-board persistent notes, generic URL fetching, and module-surface introspection. Each is a small additive tool registered on the existing `models.tools` registry, allowlisted to `CODING_AGENT` only.

The framework provides every primitive needed:

- Tools register on `models.tools` via `wireTools`. The coder's allowlist in `CODING_AGENT.tools` controls visibility.
- Approval-gated writes route through the existing `INLINE_APPROVAL` flow (`src/components/makeCobwebApproval.tsx`), the same path used by `edit_editor` / `write_device_file`.
- `localStorage` and the Cache API are platform built-ins — no new dependencies.

The work is therefore: three new tool files, a small bindings extension to expose `machineName`, a connect-time probe hook, and three short system-prompt nudge sentences appended to `CODING_AGENT.instructions`. No system-prompt mutation, no per-message hooks, no integration branch.

---

## 1. `list_installed_modules` tool — `src/agent/tools/ListInstalledModulesTool.ts`

### Responsibility

Probe the connected device for the list of installed modules (stdlib + vendor extensions) and return the result as text.

### Definition

```ts
{
  name: 'list_installed_modules',
  description:
    'Lists every MicroPython module installed on the connected device, including vendor extensions (e.g. "presto" or "picographics" on a Pimoroni board, "neopixel" on Adafruit boards). Call this when you need to know what is available before writing imports — particularly on unfamiliar or vendor-specific hardware. Returns the raw output of `help("modules")`.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  scope: 'read',
  requiresApproval: false,
}
```

### Behaviour

```ts
const PROBE_SNIPPET = "help('modules')";
const TIMEOUT_MS = 5_000;

async call(_args, ctx): Promise<string> {
  const run = this.getBindings().runCode(PROBE_SNIPPET);
  // Timeout / abort handling mirrors GetBoardInfoTool.
  const outcome = await Promise.race([run, timeout, aborted]);
  if (outcome === 'timeout') return 'Module list unavailable: probe timed out.';
  const { stdout, stderr } = outcome;
  if (stderr.trim()) return `Module list unavailable: ${stderr.trim()}`;
  if (!stdout.trim()) return 'Module list unavailable: empty response.';
  return stdout;  // raw "help('modules')" output, columns and all
}
```

If the device is not connected, `runCode` rejects with `"Not connected"` (existing `useReplConnection` behaviour); the tool catches and returns `"Board not connected. Connect a device to list its modules."`.

### Tests — `ListInstalledModulesTool.test.ts`

- Definition shape (name, scope, no parameters, no approval).
- Successful probe → returns stdout verbatim.
- `runCode` rejects with "Not connected" → returns "Board not connected" string.
- stderr present → returns "Module list unavailable: <stderr>".
- Probe timeout → returns "Module list unavailable: probe timed out".
- Abort signal aborts the in-flight call.

### File map

**Add:**
- `src/agent/tools/ListInstalledModulesTool.ts`
- `src/agent/tools/ListInstalledModulesTool.test.ts`

**Modify:**
- `src/agent/wireTools.ts` — register the new tool.
- `src/agent/config.ts` — append `'list_installed_modules'` to `CODING_AGENT.tools`. Add a sentence to coder instructions: *"When you are unsure whether a vendor or community module is available on the connected board (e.g. on Pimoroni, Adafruit, or other custom firmware), call `list_installed_modules` before writing imports."*

---

## 2. `fetch_url` tool — `src/agent/tools/FetchUrlTool.ts`

### Responsibility

Fetch any URL and return the body as text. Surface failures (CORS, 404, network) as descriptive strings the agent can reason about. Phase 1 does not cache — every call hits the network.

### Definition

```ts
{
  name: 'fetch_url',
  description:
    'Fetches the contents of a URL and returns the body as text. Use this when the user provides a documentation URL, when board notes record a URL worth consulting, or when you need to read a known docs page (including raw GitHub files for MicroPython upstream docs). GitHub repo and blob URLs auto-translate to raw.githubusercontent.com. On failure, returns a descriptive error string (CORS-blocked, 404, network error) so you can decide on a fallback.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch (http or https).' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  scope: 'read',
  requiresApproval: false,
}
```

### URL translation

GitHub URLs translate to `raw.githubusercontent.com` for cleaner content:

- `https://github.com/<owner>/<repo>` → try `raw.githubusercontent.com/<owner>/<repo>/main/README.md`. On 404, retry against `master`. On further 404, return `"No README.md found on main or master branches of <owner>/<repo>."`.
- `https://github.com/<owner>/<repo>/blob/<branch>/<path>` → `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`.
- `https://github.com/<owner>/<repo>/tree/<branch>/<path>` → returns `"Directory listing is not supported. Provide a specific file URL."` (no GitHub API call in phase 1).

Other hosts are fetched as-is.

### Behaviour

```ts
const MAX_BYTES = 30 * 1024;

async call({ url }, _ctx): Promise<string> {
  const candidates = translateGitHubUrl(url);  // may return one or more candidates for repo URLs
  for (const candidate of candidates) {
    let response: Response;
    try {
      response = await fetch(candidate);
    } catch (err) {
      // Most CORS rejections surface as TypeError "Failed to fetch".
      return `Could not fetch ${candidate}: ${describeError(err)}. The host may have blocked cross-origin access. Try search_documentation, paste the relevant section into chat, or provide a github.com URL instead.`;
    }
    if (response.status === 404) continue;  // try next README candidate, etc.
    if (!response.ok) return `Fetched ${candidate} returned HTTP ${response.status}.`;
    return truncate(await response.text(), candidate);
  }
  return `No content found at ${url}.`;
}

function truncate(body: string, url: string): string {
  if (body.length <= MAX_BYTES) return body;
  return body.slice(0, MAX_BYTES) + `\n\n... [truncated, see full file at ${url}]\n`;
}
```

No caching in phase 1. The cost is one network round-trip per call; the saving is a substantial chunk of implementation and test surface (Cache API mocking, eviction story, namespacing). Phase 2 introduces caching when typed doc tools land, at which point a shared fetcher utility makes the cost worth it.

### Tests — `FetchUrlTool.test.ts`

- Definition shape.
- Plain URL with successful fetch → body is returned.
- GitHub repo URL → tries `main/README.md`, returns body on success.
- GitHub repo URL with `main` 404 → retries `master`, returns body on success.
- GitHub repo URL with both 404 → "No README.md found".
- GitHub blob URL → translates to raw URL and fetches.
- GitHub tree URL → "Directory listing is not supported".
- `fetch` rejects (TypeError "Failed to fetch") → returns the CORS-style error string.
- Non-OK status (500) → returns "HTTP 500" string.
- Body over 30 KB → truncated with marker.

Tests stub `fetch` on `globalThis`.

### File map

**Add:**
- `src/agent/tools/FetchUrlTool.ts`
- `src/agent/tools/FetchUrlTool.test.ts`

**Modify:**
- `src/agent/wireTools.ts` — register the new tool.
- `src/agent/config.ts` — append `'fetch_url'` to `CODING_AGENT.tools`. Add a sentence to coder instructions: *"When the user provides a docs URL, when board notes record one, or when you need a known docs page (e.g. upstream MicroPython library RST at `https://raw.githubusercontent.com/micropython/micropython/master/docs/library/<module>.rst`), call `fetch_url`."*

---

## 3. Board notes — `src/agent/tools/BoardNotes*Tool.ts` (read / write / edit)

### Responsibility

Per-board persistent memory. The agent reads and updates a markdown blob keyed by `os.uname().machine`, surviving page reloads and cross-conversation. Writes are approval-gated; reads are not.

### Storage layout

- Key: `cobweb:board-notes:${machineName}`.
- Value: a plain markdown string. No frontmatter, no JSON wrapper — keep it editable both by the agent and (later) by a settings-panel UI without parsing overhead.
- Cap: 64 KB per board. Writes that would exceed the cap return an error.

### Bindings extension — `src/agent/wireTools.ts`

```ts
export type BoardIdentity =
  | { status: 'disconnected' }
  | { status: 'probing' }
  | { status: 'ready'; machineName: string };

export interface ToolBindings {
  // ... existing fields
  /**
   * State of the connect-time `os.uname().machine` probe. The notes tools
   * branch on `status` so that "no board connected" (a legitimate workflow
   * — editing local files without a device) and "board connected, still
   * identifying it" (a transient state in the first ~hundred ms after
   * connect) produce distinct messages, rather than collapsing the latter
   * into a misleading "Board not connected".
   */
  boardIdentity: BoardIdentity;
}
```

### Connect-time probe — `src/hooks/useMachineName.ts`

```ts
export function useMachineName(args: {
  connectionState: ConnectionState;
  runCode: (code: string) => Promise<RunResult>;
}): BoardIdentity {
  const [identity, setIdentity] = useState<BoardIdentity>({ status: 'disconnected' });
  useEffect(() => {
    if (args.connectionState !== 'connected') {
      setIdentity({ status: 'disconnected' });
      return;
    }
    setIdentity({ status: 'probing' });
    let cancelled = false;
    (async () => {
      try {
        const { stdout } = await args.runCode("import os; print(os.uname().machine)");
        if (cancelled) return;
        const value = stdout.trim();
        if (value) setIdentity({ status: 'ready', machineName: value });
        // Empty probe output keeps status === 'probing' rather than
        // misrepresenting it as ready-with-empty-name. The agent retries
        // on the next turn (cheap; same as a transient REPL hiccup).
      } catch {
        // Probe failure leaves status === 'probing'; the agent's next
        // notes-touching turn surfaces the "still identifying" message
        // rather than silently degrading to disconnected-shaped errors.
      }
    })();
    return () => { cancelled = true; };
  }, [args.connectionState, args.runCode]);
  return identity;
}
```

`App.tsx` calls this hook and passes the result into `wireTools`'s bindings. The probe runs once per connect transition; reconnecting the same board re-probes (cheap, and handles devices whose machine string is set after early boot).

`GetBoardInfoTool` keeps its own probe — sharing the result via cross-system state would couple the connect-time hook to the agent runtime. The duplication cost is one extra `runCode` call per connect, which is negligible on the existing serial latency budget.

### `read_board_notes`

```ts
{
  name: 'read_board_notes',
  description:
    'Reads the persistent notes for the currently connected board. Notes are scoped per-board (by os.uname().machine) and survive across sessions. Use to recall context the agent established in previous conversations: vendor module surface, useful docs URLs, board-specific pin assignments, gotchas. Returns "" if no notes exist yet.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  scope: 'read',
  requiresApproval: false,
}
```

```ts
async call(_args, _ctx): Promise<string> {
  const { boardIdentity } = this.getBindings();
  if (boardIdentity.status === 'disconnected') {
    return 'No board connected. Notes are scoped per-board; connect a device to read its notes.';
  }
  if (boardIdentity.status === 'probing') {
    return 'Identifying the connected board… try again in a moment.';
  }
  return localStorage.getItem(`cobweb:board-notes:${boardIdentity.machineName}`) ?? '';
}
```

### `write_board_notes`

```ts
{
  name: 'write_board_notes',
  description:
    'Replaces the persistent notes for the currently connected board with the provided content. Prefer edit_board_notes for incremental changes; use this for the first write or full rewrites. The user reviews the proposed content before it is saved.',
  parameters: {
    type: 'object',
    properties: { content: { type: 'string' } },
    required: ['content'],
    additionalProperties: false,
  },
  scope: 'write',
  requiresApproval: true,
}
```

```ts
async call({ content }, _ctx): Promise<string> {
  const { boardIdentity } = this.getBindings();
  if (boardIdentity.status === 'disconnected') return 'No board connected. Notes are scoped per-board.';
  if (boardIdentity.status === 'probing') return 'Identifying the connected board… try again in a moment.';
  if (content.length > 64 * 1024) {
    return `Content exceeds 64 KB note cap (${content.length} bytes). Trim before saving.`;
  }
  localStorage.setItem(`cobweb:board-notes:${boardIdentity.machineName}`, content);
  return `Saved ${content.length} bytes to notes for "${boardIdentity.machineName}".`;
}
```

### `edit_board_notes`

```ts
{
  name: 'edit_board_notes',
  description:
    'Edits the persistent notes for the currently connected board by replacing one occurrence of old_string with new_string. old_string must appear exactly once in the current notes; add surrounding context to disambiguate if necessary. The user reviews the change before it is saved.',
  parameters: {
    type: 'object',
    properties: {
      old_string: { type: 'string' },
      new_string: { type: 'string' },
    },
    required: ['old_string', 'new_string'],
    additionalProperties: false,
  },
  scope: 'write',
  requiresApproval: true,
}
```

```ts
async call({ old_string, new_string }, _ctx): Promise<string> {
  const { boardIdentity } = this.getBindings();
  if (boardIdentity.status === 'disconnected') return 'No board connected. Notes are scoped per-board.';
  if (boardIdentity.status === 'probing') return 'Identifying the connected board… try again in a moment.';
  const key = `cobweb:board-notes:${boardIdentity.machineName}`;
  const current = localStorage.getItem(key) ?? '';
  const occurrences = countOccurrences(current, old_string);
  if (occurrences === 0) return `old_string not found in current notes.`;
  if (occurrences > 1) return `old_string appears ${occurrences} times in current notes. Add surrounding context to make it unique.`;
  const updated = current.replace(old_string, new_string);
  if (updated.length > 64 * 1024) return `Updated content exceeds 64 KB note cap. Trim before saving.`;
  localStorage.setItem(key, updated);
  return `Notes updated for "${boardIdentity.machineName}".`;
}
```

The uniqueness contract mirrors `edit_editor` / `edit_device_file`. Same family of error messages so the model's existing skills transfer.

### Approval rendering

Phase 1 uses the default approval card — the user sees the tool name, the args (the full content for `write_board_notes`, the `old_string` / `new_string` pair for `edit_board_notes`), and approves or rejects. Custom diff rendering inside `makeCobwebApproval.tsx` is a polish item; defer until the basic flow is observed.

### Tests — three tool files plus the hook

- `BoardNotesReadTool.test.ts` — `disconnected` → "No board connected" message; `probing` → "Identifying…" message; `ready` with no entry → ""; `ready` with entry → returns it.
- `BoardNotesWriteTool.test.ts` — `disconnected` and `probing` → respective messages, localStorage unchanged; `ready` with small content → written, success message returned; `ready` with oversize content → cap error, localStorage unchanged.
- `BoardNotesEditTool.test.ts` — `disconnected` and `probing` short-circuit before localStorage access; uniqueness violations (zero / multiple occurrences) → corresponding error strings; valid edit → localStorage updated; oversize result → cap error.
- `useMachineName.test.ts` — `renderHook` with a fake `runCode`. Initial state: `disconnected`. On `connectionState` → `'connected'`: status flips to `probing`, then `ready` with the trimmed machine string when the probe resolves. Empty probe output keeps status `probing`. `runCode` rejection keeps status `probing`. On `connectionState` → `'disconnected'`: status flips to `disconnected`.

Tests stub `localStorage` on `globalThis` (or use `happy-dom`'s built-in).

### File map

**Add:**
- `src/agent/tools/BoardNotesReadTool.ts`
- `src/agent/tools/BoardNotesWriteTool.ts`
- `src/agent/tools/BoardNotesEditTool.ts`
- `src/agent/tools/BoardNotesReadTool.test.ts`
- `src/agent/tools/BoardNotesWriteTool.test.ts`
- `src/agent/tools/BoardNotesEditTool.test.ts`
- `src/hooks/useMachineName.ts`
- `src/hooks/useMachineName.test.ts`

**Modify:**
- `src/agent/wireTools.ts` — export `BoardIdentity` discriminated union; extend `ToolBindings` with `boardIdentity: BoardIdentity`; register the three new tools.
- `src/agent/config.ts` — append `'read_board_notes'`, `'write_board_notes'`, `'edit_board_notes'` to `CODING_AGENT.tools`. Add a sentence to coder instructions: *"At the start of work on a connected board, call `read_board_notes` to recall context from previous sessions. When you learn something durable about the board (vendor modules, useful docs URLs, pin assignments, gotchas), update the notes via `edit_board_notes` (or `write_board_notes` for the first entry) so future sessions benefit."*
- `src/App.tsx` — invoke `useMachineName`; pass the returned `BoardIdentity` into `wireTools` bindings.

---

## 4. System-prompt budget

Three sentences total appended to `CODING_AGENT.instructions`:

1. *"At the start of work on a connected board, call `read_board_notes` to recall context from previous sessions. When you learn something durable about the board (vendor modules, useful docs URLs, pin assignments, gotchas), update the notes via `edit_board_notes` (or `write_board_notes` for the first entry) so future sessions benefit."*
2. *"When you are unsure whether a vendor or community module is available on the connected board, call `list_installed_modules` before writing imports."*
3. *"When the user provides a docs URL, when board notes record one, or when you need a known docs page (e.g. upstream MicroPython library RST at `https://raw.githubusercontent.com/micropython/micropython/master/docs/library/<module>.rst`), call `fetch_url`."*

These are append-only string additions to the existing instructions literal. No mutation, no per-turn assembly. The tool descriptions themselves carry the bulk of the "when to call" guidance; the system-prompt sentences exist only to nudge tool *order* (read notes first, fetch known URLs before searching, probe modules before importing unknowns).

---

## 5. Concurrency considerations

No instruction mutation. No per-message hooks awaiting fetches before dispatch. The only shared state is the `boardIdentity` binding, updated by `useMachineName` on connect transitions.

- **Mid-turn disconnect.** Tool calls read `boardIdentity` at call time via the bindings closure. A disconnect mid-tool surfaces the disconnected message on subsequent calls; in-flight `runCode` rejects via the existing `ReplDisconnectedError` path.
- **Probing-state turn.** If the user sends a notes-touching message in the brief window between connect and probe completion, the tools return the "Identifying the connected board…" message. The agent's natural response is to retry on the next turn (cheap), or to proceed with non-notes-touching work in the meantime.
- **Concurrent tool calls.** `AgentRunner` may fire multiple tool calls per turn via `Promise.all`. `localStorage` is synchronous — concurrent `write_board_notes` + `edit_board_notes` in the same turn would race, but the model is unlikely to emit both, and the second wins (last-write semantics). Document but don't implement serialisation in phase 1.

---

## 6. Issue breakdown

Three small additive PRs, all branched off `main` per CLAUDE.md's default. No integration branch — the surface is additive and self-contained. Issues are independent and can land in any order or in parallel.

| Issue | Title | Files added | Files modified |
|-------|-------|-------------|----------------|
| A | Board notes (read / write / edit) + `machineName` capture | `BoardNotes{Read,Write,Edit}Tool.ts` + tests, `useMachineName.ts` + test | `wireTools.ts`, `config.ts`, `App.tsx` |
| B | `fetch_url` tool | `FetchUrlTool.ts` + test | `wireTools.ts`, `config.ts` |
| C | `list_installed_modules` tool | `ListInstalledModulesTool.ts` + test | `wireTools.ts`, `config.ts` |

---

## 7. UI verification (per issue)

For each tool issue, browser verification follows the same shape:

**A (board notes)**
1. Connect a board, ask the agent to remember a note ("note that GP25 is the onboard LED on this Pico") → coder calls `write_board_notes`, approval card fires showing the content, user approves, tool returns success.
2. Refresh the page, start a new conversation, ask "what do you know about this board?" → coder calls `read_board_notes`, the saved note is in the result.
3. Disconnect, connect a different board → `read_board_notes` returns "" (no leakage between boards).
4. Ask the agent to update an existing note via `edit_board_notes` → approval card fires showing the old/new strings, approve, tool returns success.
5. With no board connected (legitimate workflow — editing a local file) → all three tools return "No board connected" rather than blocking other work.
6. Sending a notes-touching message in the first ~hundred ms after connect → returns "Identifying the connected board…" rather than misreporting as disconnected.

**B (`fetch_url`)**
1. Paste `https://github.com/pimoroni/presto` in chat → coder calls `fetch_url`, README content is returned.
2. Paste a CORS-rejecting URL (e.g. some non-CORS-friendly docs site) → coder receives the descriptive error string, does not error out.
3. Paste a `github.com/owner/repo/blob/main/foo.md` URL → translates to raw, fetches successfully.

**C (`list_installed_modules`)**
1. Connect a Pico → ask "what modules are available on this board?" → tool fires, response includes `machine`, `network`, etc.
2. Connect a Pimoroni Presto (if available) → same prompt → tool fires, response includes `presto`, `picographics`, etc.
3. With board disconnected → tool returns "Board not connected".

---

## 8. Future work (phase 2)

These are explicitly out of scope for phase 1 but documented so the design space is clear when (or if) they're picked up:

- **Typed doc tools.** `get_board_quickref` and `get_module_docs` as thin URL-builder wrappers. Add only if browser observation shows the model under-fetches when given the generic `fetch_url` plus URL hints.
- **Doc fetcher utility with caching.** When the typed tools land (or sooner if observed network traffic from repeated `fetch_url` calls is wasteful), introduce a shared `src/docsContext/fetcher.ts` that wraps `fetch` with Cache API caching. At that point versioned cache names (`micropython-docs-v${firmwareVersion}`) likely become worth their cost. `FetchUrlTool` and the typed tools would both consume the shared fetcher.
- **`search_documentation` sub-agent.** Gemini-only. Pattern matches `delegate_to_coder` (sub-agent + `createAgentTool` + dedicated `AgentRunner` with `nativeTools: [{ googleSearch: {} }]`). Natural fallback for `fetch_url` CORS errors. Coder-only allowlist; provider-conditional registration.
- **Notes management UI.** A settings-panel section listing per-board notes with edit and clear controls. Useful when notes accumulate across many boards or when the agent over-records.
- **Auto-summarisation of long-running notes.** If notes grow toward the 64 KB cap, a periodic "summarise oldest entries" pass keeps them lean. Probably triggered manually from a settings UI rather than automatically.
