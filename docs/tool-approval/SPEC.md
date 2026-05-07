# Tool Approval — Technical Specification

## Overview

`@mast-ai/react-ui` already provides the full approval pipeline. We do not need to invent suspending tools, an approval store, or a cancellation-safety dance — the framework owns those.

What we are responsible for in this feature:

1. Introducing two new single-edit tools (`edit_editor`, `edit_device_file`) that take `old_string` / `new_string` and apply uniqueness-based find/replace, mirroring Claude Code's Edit tool.
2. Introducing two batched-edit tools (`multi_edit_editor`, `multi_edit_device_file`) that take an array of `{ old_string, new_string }` edits and apply them sequentially and atomically (all-or-nothing), mirroring Claude Code's MultiEdit.
3. Flipping the existing `write_editor`'s `requiresApproval` to `true` so it joins the already-flagged write tools (`write_device_file`, `delete_device_file`, `make_device_dir`).
4. Plugging a custom `renderApproval` slot into `<ConversationPanel>` that dispatches on tool name — multi-hunk diff card for the four `*edit*_*` tools, content-preview card for `write_*` tools, confirm card for `delete_device_file` / `make_device_dir`.
5. Updating the agent instructions in `CODING_AGENT` so the model knows when to reach for `edit_editor` (one partial change), `multi_edit_editor` (several related changes in one call), `write_editor` (new program / full rewrite), and the device-file analogues.

Everything else — queueing pending approvals, injecting "user cancelled" results into the runner, cancelling on `useAgent().cancel()` / `reset()` — is handled by the framework.

---

## How the framework's approval flow works (relevant primitives)

From `@mast-ai/react-ui`:

- `<AgentProvider>` accepts `onApprovalRequired`. Default is "return `INLINE_APPROVAL` for every flagged tool" — so any tool with `requiresApproval: true` is automatically queued for inline approval with no extra props.
- `useAgent().pendingApprovals: PendingApproval[]` — live queue. Each entry has `toolName`, `args`, and `approve()` / `reject()` / `respondWith(result: string)`.
  - `approve()` → tool's `call()` runs.
  - `reject()` → tool is short-circuited with the synthetic `APPROVAL_CANCELLED_RESULT` string ("User cancelled the tool call.").
  - `respondWith(s)` → tool is short-circuited with `s` as the tool result. (Useful for "old_string not found.")
- `<ConversationPanel renderApproval={...}>` — slot called for each tool event whose call is awaiting approval; receives `(entry, approval)`. Returning a node from this slot replaces the default `<InlineApproval>` card for that entry only. Non-approval tool events fall through to the default `<ToolCallBlock>` rendering.
- The runner is paused while a `PendingApproval` is unresolved; on `cancel()` or `reset()`, the framework aborts the run and the pending approvals are cleaned up automatically.

This means: for our purposes, a "tool that needs approval" is just a tool whose definition sets `requiresApproval: true`. The tool's `call()` only runs after the user has approved; if it runs, it can apply its mutation unconditionally. No promise plumbing inside the tool.

---

## New tools

### `EditEditorTool` (`edit_editor`)

Partial edit of the editor buffer using uniqueness-based find/replace, modelled on Claude Code's Edit tool.

**Args:**

```ts
interface EditEditorArgs {
  old_string: string;  // exact substring currently in the editor; must appear exactly once
  new_string: string;  // replacement
}
```

**`ToolDefinition`:**

- `name: 'edit_editor'`
- `scope: 'write'`
- `requiresApproval: true`
- Description (verbatim shape, exact wording finalised in implementation):
  > "Replaces a unique substring `old_string` in the editor with `new_string`. `old_string` must match the editor contents exactly (including whitespace) and must appear exactly once — include enough surrounding context to disambiguate. Prefer this over `write_editor` for any change that does not rewrite the whole buffer."

**`call(args)` body:**

1. Read current editor content via `bindings.getEditorContent()`.
2. Count occurrences of `old_string` (literal substring, no regex).
3. If 0 → return `'old_string not found in editor.'` (model retries with more context).
4. If > 1 → return `'old_string is ambiguous — appears N times. Include more surrounding context.'`.
5. Else → `setEditorContent(content.replace(old_string, new_string))` and return `'Editor updated.'`.

The find/replace runs only after the user has clicked Approve, so the buffer the user reviewed in the diff card *is* the buffer the edit applies to. (Per PRD: uniqueness is the only guard. If the user typed in the editor between approval and apply — fine; the diff still computes correctly because the renderer reads live editor content too. See "Approval renderer" below.)

### `EditDeviceFileTool` (`edit_device_file`)

Same shape, scoped to a file on the device.

**Args:**

```ts
interface EditDeviceFileArgs {
  path: string;        // absolute, POSIX-style
  old_string: string;
  new_string: string;
}
```

**`ToolDefinition`:**

- `name: 'edit_device_file'`
- `scope: 'write'`
- `requiresApproval: true`
- Description: similar to `edit_editor`, but for a device file by path.

**`call(args)` body:**

1. If `bindings.deviceFs === null` → return `'Device is not connected.'`.
2. Read current bytes via `deviceFs.readBytes(path)`. Decode as UTF-8 (fatal). On `TypeError` → return `'Cannot edit binary file.'`.
3. Apply the same uniqueness check as `edit_editor`. Return the same error strings on miss/ambiguity.
4. On success → `deviceFs.writeText(path, replaced)` and return `'File updated.'`.

The host-side read–modify–write between approval and apply mirrors `WriteDeviceFileTool`'s existing model (no atomicity beyond what `DeviceFs.writeText` already provides).

### `MultiEditEditorTool` (`multi_edit_editor`)

Batched partial edits over the editor buffer. Each edit is the same shape as `edit_editor`'s args; the array is applied sequentially against the running buffer. All-or-nothing: if any edit's `old_string` is missing or non-unique against the buffer state at its turn, *no* edits apply and the model gets a structured error.

**Args:**

```ts
interface MultiEditEditorArgs {
  edits: Array<{
    old_string: string;
    new_string: string;
  }>;
}
```

**`ToolDefinition`:**

- `name: 'multi_edit_editor'`
- `scope: 'write'`
- `requiresApproval: true`
- Description (final wording in implementation):
  > "Applies a sequence of `{ old_string, new_string }` edits to the editor in order. Each `old_string` must appear exactly once *at its turn* (i.e. after all earlier edits in the array have been applied). All edits succeed or none do. Use this when the agent needs to make several related changes — renaming a symbol everywhere, refactoring a small set of related lines, etc. — in one approval. For a single change, use `edit_editor`."

**`call(args)` body:**

Implemented in two stages so the simulation logic is shared with the renderer:

1. `simulateMultiEdit(source, edits)` (in `src/lib/editApproval.ts`) walks the edits array, applying each successful step to a running string. It returns either:
   - `{ ok: true; final: string; hunks: ChangedRegion[] }` — all edits validated and applied; `hunks` are the merged contiguous changed regions between `source` and `final`, each with `firstLine`, `before` lines, `after` lines, and `contextBefore` / `contextAfter` lines.
   - `{ ok: false; index: number; reason: 'missing' | 'ambiguous'; count?: number }` — edit `index` failed; nothing was applied.
2. `call()` reads the current editor content, calls `simulateMultiEdit`, and either:
   - On `ok: true` → `setEditorContent(result.final)` and return `'Editor updated. N edit(s) applied.'`.
   - On `ok: false; reason: 'missing'` → return `Edit #${index + 1}: old_string not found.`.
   - On `ok: false; reason: 'ambiguous'` → return `Edit #${index + 1}: old_string is ambiguous — appears ${count} times.`.

The same error strings are surfaced in the approval card (see "MultiEdit branch" below) so the user can choose Reject or `respondWith` the matching message.

### `MultiEditDeviceFileTool` (`multi_edit_device_file`)

Same shape as `multi_edit_editor`, scoped to a file on the device.

**Args:**

```ts
interface MultiEditDeviceFileArgs {
  path: string;
  edits: Array<{
    old_string: string;
    new_string: string;
  }>;
}
```

**`ToolDefinition`:** as `multi_edit_editor`, with `path` documented in the description.

**`call(args)` body:**

1. If `bindings.deviceFs === null` → return `'Device is not connected.'`.
2. Read + decode UTF-8 (fatal). On `TypeError` → return `'Cannot edit binary file.'`.
3. Run `simulateMultiEdit`. On failure return the same `Edit #N: ...` strings as `multi_edit_editor`.
4. On success → `deviceFs.writeText(path, result.final)` and return `'File updated. N edit(s) applied.'`.

---

## Modified tools

### `WriteEditorTool` — flip `requiresApproval` to `true`

Currently `requiresApproval: false`. Flip to `true`. No body change. Description tightens:

> "Replaces the entire contents of the user's code editor with the given code. Use this only for new programs or full rewrites; use `edit_editor` for partial changes."

### `WriteDeviceFileTool`, `DeleteDeviceFileTool`, `MakeDeviceDirTool` — already flagged

These already have `requiresApproval: true` but currently the flag is dead code (no `onApprovalRequired` is wired, so `<AgentProvider>` falls through to the default behaviour — which will start gating once any approval renderer is in place). No changes to these tools' bodies; they pick up the approval flow automatically once the renderer is wired and the editor write tool also opts in.

---

## Approval renderer

A single component, `<CobwebApproval>`, lives at `src/components/CobwebApproval.tsx`. It is passed to `<ConversationPanel>` via `renderApproval`. Signature matches the framework's `RenderApproval` type: `(entry, approval) => ReactNode`.

### Dispatch

```ts
switch (entry.name) {
  case 'edit_editor':
  case 'edit_device_file':
  case 'multi_edit_editor':
  case 'multi_edit_device_file':
    return <EditApprovalCard entry={entry} approval={approval} ... />;
  case 'write_editor':
  case 'write_device_file':
    return <WriteApprovalCard entry={entry} approval={approval} ... />;
  case 'delete_device_file':
  case 'make_device_dir':
    return <ConfirmApprovalCard entry={entry} approval={approval} ... />;
  default:
    return <InlineApproval entry={entry} approve={approval.approve} reject={approval.reject} respondWith={approval.respondWith} />;
}
```

The `default` branch falls back to the bundled `<InlineApproval>` so any future tool that flips `requiresApproval: true` without us updating the renderer still works (it gets the basic Approve / Reject card).

### `EditApprovalCard`

Props (in addition to `entry` + `approval`):

- A way to read the source content for diffing:
  - For `edit_editor` / `multi_edit_editor`: `getEditorContent: () => string`.
  - For `edit_device_file` / `multi_edit_device_file`: `readDeviceFile: (path: string) => Promise<string | null>` (returns `null` on binary or read error).
- A reveal callback `revealEditorRange: (from: number, to: number) => void` (or, for the device cards once they land, the device-file equivalent). Auto-invoked once on first render of the card so the user immediately sees what part of the buffer the agent is asking about; also wired to a "Reveal" button in the card header so the user can re-scroll to the affected range any time.

Render flow:

1. Parse `entry.args`. For `edit_*` tools, normalise to `{ edits: [{ old_string, new_string }], path? }`. For `multi_edit_*` tools, take `args.edits` (and `args.path` for device).
2. Read source content. For the editor, synchronous. For device files, kick off the async read in `useEffect` and show a "loading…" placeholder until it resolves.
3. Run `simulateMultiEdit(source, edits)` from `src/lib/editApproval.ts`. Two outcomes:
   - **Failure.** The card shows "Edit #N: old_string not found." or "Edit #N: old_string is ambiguous — appears M times.", referencing the failing edit's index (1-based for display). Approve is disabled. Reject is enabled. A secondary "Tell the agent" button calls `approval.respondWith(...)` with the exact same string the tool body would have produced (so the model gets a uniform error whether the user clicked Reject or the tool ran post-approval).
   - **Success.** Render the cumulative diff as one or more hunks (below). Approve + Reject both enabled.
4. **Multi-hunk diff rendering.** `simulateMultiEdit` returns merged contiguous changed regions between `source` and `final`. Two regions whose context windows overlap are merged into one hunk so the user does not see overlapping context. Each hunk renders:
   - A small `@@ Lines X–Y @@` header with the source's line numbers.
   - Two lines of unchanged context above and below, clipped at file start/end.
   - The changed region itself, with `diffWords` from the `diff` package run on the contiguous (`before`, `after`) line block — red strikethrough on removed segments, green background on added segments.
   - A line-number gutter on the left, reflecting the source's line numbers (not 1-based-from-card).
5. **Header line.** Dispatches by tool kind:
   - `edit_editor` → "Edit *editor*"
   - `multi_edit_editor` → "Edit *editor* — N change(s)"
   - `edit_device_file` → "Edit *`<path>`*"
   - `multi_edit_device_file` → "Edit *`<path>`* — N change(s)"

   The header also carries a small "Reveal" button next to the "requires approval" label whenever `find.kind === 'unique'`, calling `revealEditorRange` (or the device-file equivalent) with the affected range.
6. **Buttons.** Approve / Reject. Approve calls `approval.approve()`. Reject calls `approval.reject()`.

#### Reveal-in-editor primitive

`useEditor` exposes `revealRange(from, to)` for the editor card and an analogous helper will exist for the device card. The implementation:

1. Dispatches `EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' })` to bring the affected range into the middle of the viewport.
2. Adds a `cobweb-reveal-highlight` decoration on the range via a dedicated `StateField` + `StateEffect` pair, then clears it after ~1.7s. The `cobweb-reveal-highlight` class fades from amber → transparent via a CSS keyframe (`cobweb-reveal-fade`).

This mirrors the `agent-text-editor` reference: a transient highlight gives the user a visual handshake of "this is the spot the agent wants to change" without permanently marking the buffer.

### `WriteApprovalCard`

Renders the new content as a scrollable, syntax-highlighted preview (CodeMirror in read-only mode is overkill for v1 — use a `<pre>` with `font-mono text-xs` and a `max-height: 300px; overflow: auto`). Header: "Replace editor with new content" or "Write *`/path/to/file.py`*". Buttons: Approve / Reject.

We do *not* render a diff for `write_*` tools. The PRD ruled this out: a whole-buffer replacement diff is dominated by "remove everything, add new thing" noise.

### `ConfirmApprovalCard`

For `delete_device_file` and `make_device_dir`. Header dispatches on tool name:

- `delete_device_file` → "Delete *`<path>`*" (destructive styling — red Approve button).
- `make_device_dir` → "Create directory *`<path>`*" (neutral styling).

Body: just the path. Buttons: Approve / Reject.

### Where bindings come from

`<CobwebApproval>` is rendered deep inside `<ConversationPanel>`. The simplest wiring is to pass the renderer from `App.tsx` as a closure that has the bindings already:

```tsx
const renderApproval: RenderApproval = (entry, approval) => (
  <CobwebApproval
    entry={entry}
    approval={approval}
    getEditorContent={getContent}
    revealEditorRange={revealRange}
    readDeviceFile={async (p) => {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(await deviceReadBytes(p));
      } catch {
        return null;
      }
    }}
  />
);
```

`<AgentPanel>` accepts `renderApproval` as a prop and forwards it to `<ConversationPanel>`.

---

## Wiring

### `ToolBindings` — `replaceEditorRange`

`edit_editor` reads the editor via the existing `getEditorContent` but writes via a new `replaceEditorRange(from: number, to: number, replacement: string)` binding. The implementation dispatches a CodeMirror change scoped to the affected range so the user's scroll position is preserved across the edit; routing through `setEditorContent` (which replaces the entire document) reset the viewport on every Approve. `edit_device_file` only needs the existing `deviceFs`.

### `wireTools.ts`

Register the four new tools alongside the others:

```ts
tools.register(new EditEditorTool(get));
tools.register(new EditDeviceFileTool(get));
tools.register(new MultiEditEditorTool(get));
tools.register(new MultiEditDeviceFileTool(get));
```

### `CODING_AGENT.tools` (in `src/agent/config.ts`)

Add `'edit_editor'`, `'edit_device_file'`, `'multi_edit_editor'`, and `'multi_edit_device_file'` to the `tools` list.

### `CODING_AGENT.instructions`

Steer the model toward the right edit tool. Sketch:

> "For a single partial change to existing code, prefer `edit_editor` (or `edit_device_file` for a file on the device) — they take `old_string` / `new_string` and require uniqueness; the user reviews a focused diff. For several related changes in one go, use `multi_edit_editor` (or `multi_edit_device_file`) with an array of edits applied atomically — the user reviews all the diffs together and approves once. Use `write_editor` only when creating a new program from scratch or replacing the whole buffer; use `write_device_file` only for new files or full rewrites. Every editing tool requires user approval before it applies."

The existing description of `write_editor` ("When asked to write code, use write_editor then offer to run it.") is rewritten so the default partial-edit path is `edit_editor` / `multi_edit_editor`.

### `<AgentProvider>`

No new props needed. The default `onApprovalRequired` is already "INLINE_APPROVAL for every approval-required call." We pass `renderApproval` through to `<ConversationPanel>`, not to `<AgentProvider>`.

---

## File map

**Add:**

- `src/agent/tools/EditEditorTool.ts`
- `src/agent/tools/EditEditorTool.test.ts`
- `src/agent/tools/EditDeviceFileTool.ts`
- `src/agent/tools/EditDeviceFileTool.test.ts`
- `src/agent/tools/MultiEditEditorTool.ts`
- `src/agent/tools/MultiEditEditorTool.test.ts`
- `src/agent/tools/MultiEditDeviceFileTool.ts`
- `src/agent/tools/MultiEditDeviceFileTool.test.ts`
- `src/components/CobwebApproval.tsx` (dispatcher + card components)
- `src/lib/editApproval.ts` — pure helpers: `findUniqueOccurrence(source, target): { kind: 'unique'; index: number } | { kind: 'missing' } | { kind: 'ambiguous'; count: number }`, `simulateMultiEdit(source, edits): { ok: true; final: string; hunks: ChangedRegion[] } | { ok: false; index: number; reason: 'missing' | 'ambiguous'; count?: number }`, `mergeOverlappingHunks(hunks, contextLines): ChangedRegion[]`.
- `src/lib/editApproval.test.ts`

**Modify:**

- `src/agent/tools/WriteEditorTool.ts` — flip `requiresApproval` to `true`; tighten description.
- `src/agent/wireTools.ts` — register the two new tools; add `replaceEditorRange` to `ToolBindings`.
- `src/agent/config.ts` — add tool names; rewrite the partial-edit guidance paragraph.
- `src/hooks/useEditor.ts` — add `replaceRange(from, to, replacement)` (targeted dispatch, scroll-preserving) and `revealRange(from, to)` (scroll into center + temporary highlight via a dedicated `StateField` + `StateEffect`).
- `src/components/AgentPanel.tsx` — accept `renderApproval` prop; forward to `<ConversationPanel>`.
- `src/App.tsx` — register tools synchronously during render (so `<AgentProvider>` sees `requiresApproval` flags on its first memo and installs the approval proxy); build the `renderApproval` closure with editor + reveal bindings; pass to `<AgentPanel>`.
- `src/index.css` — Cobweb approval-card + diff styles, plus the `cobweb-reveal-highlight` class and `cobweb-reveal-fade` keyframe used by `revealRange`.

**No change:**

- `src/agent/tools/WriteDeviceFileTool.ts`, `DeleteDeviceFileTool.ts`, `MakeDeviceDirTool.ts` — they already flag `requiresApproval: true`; they automatically pick up the approval flow once the renderer is in place.

**Dependencies:**

- Add `diff` (the `jsdiff` package — `import { diffWords } from 'diff'`). No `react-diff-viewer` or similar.

---

## Testing

Per project convention, UI components are not unit-tested. The pure logic is — that is where bugs hide:

- `src/lib/editApproval.test.ts`:
  - `findUniqueOccurrence`: empty target, single match at start / middle / end, zero matches, two matches, overlapping matches (e.g. `target = 'aa'`, `source = 'aaaa'` → counted by non-overlapping replace semantics, matching `String.prototype.replace`'s behaviour). Multi-line matches are exercised by `simulateMultiEdit`.
  - `simulateMultiEdit`:
    - Empty `edits` array → `ok: true`, `hunks: []`, `final === source`.
    - Single edit, success — equivalent to single-edit-tool behaviour.
    - Two non-adjacent edits → two hunks.
    - Two edits whose context windows overlap (e.g. lines 5 and 7 with 2 lines context) → merged into one hunk.
    - Edit #2's `old_string` references content produced by edit #1 → succeeds (running buffer; not original).
    - Edit #2's `old_string` is missing in the original *but* present after edit #1 → succeeds.
    - Edit #1 ambiguous → `ok: false; index: 0; reason: 'ambiguous'; count: N`.
    - Edit #2 missing in the running buffer → `ok: false; index: 1; reason: 'missing'`. Verify the running buffer was *not* committed (caller sees the original).
- `src/agent/tools/EditEditorTool.test.ts` — mock bindings; verify `not found`, `ambiguous`, `unique` paths return the expected strings and call `setEditorContent` only on the unique path.
- `src/agent/tools/EditDeviceFileTool.test.ts` — mock `DeviceFs`; verify `'Device is not connected.'`, binary-file rejection, the three find-replace branches, and the success path calls `writeText` with the replaced content.
- `src/agent/tools/MultiEditEditorTool.test.ts` — mock bindings; verify (a) the success path applies all edits and calls `setEditorContent` exactly once with the final string, (b) failures at edit index 0 and index 1 return the expected `Edit #N: ...` strings and do *not* call `setEditorContent`.
- `src/agent/tools/MultiEditDeviceFileTool.test.ts` — mock `DeviceFs`; verify the disconnect / binary / failure paths do not call `writeText`, and the success path calls `writeText` exactly once with the final string.

The renderer dispatch and "edit no longer applies" handling are validated end-to-end via manual browser testing against the success criteria in the PRD.

---

## Phasing / Issue Breakdown

This feature ships behind the GitHub label `tool-approval`. Each item below becomes its own issue / PR.

1. **Docs.** PRD + SPEC + GitHub label + epic issue. (Initial docs PR plus a follow-up PR that folds MultiEdit in.)
2. **`edit_editor` + diff approval renderer.** Adds `EditEditorTool`, `editApproval` helpers + tests (`findUniqueOccurrence`, `simulateMultiEdit` — implemented now, used here for the single-edit case and reused by phases 6–7), `CobwebApproval` dispatcher, `EditApprovalCard` with single-hunk rendering. Flips `WriteEditorTool.requiresApproval` to `true` and adds a placeholder `WriteApprovalCard` that just shows "Replace editor with new content" + Approve/Reject (no preview yet — kept minimal so this PR is single-purpose). Wires `renderApproval` into `<AgentPanel>` and `<ConversationPanel>`. Updates `CODING_AGENT.instructions` for `edit_editor` only.
3. **`edit_device_file` + diff approval for it.** Adds `EditDeviceFileTool` + tests; extends the dispatcher to render `EditApprovalCard` for it (async source read). Updates instructions.
4. **Confirmation cards.** Replaces the placeholder `WriteApprovalCard` with the scrollable preview; adds `ConfirmApprovalCard` for `delete_device_file` and `make_device_dir`. (Depends on #2.)
5. **Multi-hunk renderer + `multi_edit_editor`.** Extends `EditApprovalCard` to render multiple hunks via `simulateMultiEdit`'s output, including the `Edit #N: ...` failure branch. Adds `MultiEditEditorTool` + tests. Updates `CODING_AGENT.instructions` to mention `multi_edit_editor`. (Depends on #2.)
6. **`multi_edit_device_file`.** Adds `MultiEditDeviceFileTool` + tests; routes it through the multi-hunk renderer. Updates instructions. (Depends on #3 and #5.)
7. **Polish + verification.** Manual cancel/reset testing during a pending approval; verify no orphaned promises survive; tighten copy on cards (single-hunk, multi-hunk, failure-state, write-preview, confirm) based on the live UX. (Depends on #2-6.)

Each issue body should reference this SPEC by section and state `Depends on #N` for explicit dependencies.

---

## Open Questions

- **Approve-all toggle.** PRD calls it out of scope. If users ask, the cleanest extension point is `<AgentProvider approvalOverride={['!edit_editor']}>` (suppress approval for one tool at runtime). We do not need a custom `onApprovalRequired` for this.
- **Diff styling.** v1 uses `diffWords` within each hunk. Line-level diffing (`diffLines`) is an alternative for code; we prefer word-level since edits are typically tight. Revisit if the rendered diff is hard to read for whitespace-heavy languages.

## Decisions

- **`multi_edit_editor` / `multi_edit_device_file` — not implemented.** The batched-edit tools were designed to give the user one combined approval for multiple changes, but the simpler approach is better: the agent calls `edit_editor` (or `edit_device_file`) once per change and the user approves each individually. The agent instructions steer the model toward this pattern. Issues #133 and #134 closed.
