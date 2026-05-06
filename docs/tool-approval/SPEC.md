# Tool Approval — Technical Specification

## Overview

`@mast-ai/react-ui` already provides the full approval pipeline. We do not need to invent suspending tools, an approval store, or a cancellation-safety dance — the framework owns those.

What we are responsible for in this feature:

1. Introducing two new partial-edit tools (`edit_editor`, `edit_device_file`) that take `old_string` / `new_string` and apply uniqueness-based find/replace, mirroring Claude Code's Edit tool.
2. Flipping the existing `write_editor`'s `requiresApproval` to `true` so it joins the four already-flagged write tools (`write_device_file`, `delete_device_file`, `make_device_dir`).
3. Plugging a custom `renderApproval` slot into `<ConversationPanel>` that dispatches on tool name — diff card for the two `edit_*` tools, content-preview card for `write_*` tools, confirm card for `delete_device_file` / `make_device_dir`.
4. Updating the agent instructions in `CODING_AGENT` so the model knows when to reach for `edit_editor` (partial change to existing code) vs. `write_editor` (new program / full rewrite).

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

Props (in addition to `entry` + `approval`): a way to read the source content for diffing.

- For `edit_editor`: receives `getEditorContent: () => string`.
- For `edit_device_file`: receives `readDeviceFile: (path: string) => Promise<string | null>` (returns `null` on binary or read error).

Render flow:

1. Parse `entry.args` into `{ old_string, new_string, path? }`.
2. Read source content. For the editor, synchronous. For device files, kick off the async read in `useEffect` and show a "loading…" placeholder until it resolves.
3. Locate `old_string` in source. Three states:
   - **Not found.** Show "Edit no longer applies — `old_string` is not in the buffer." Approve button disabled. Reject button enabled, plus a "Tell the agent" button that calls `approval.respondWith('old_string not found in editor.')` (same message the tool body would have produced).
   - **Multiple matches.** Show "Edit is ambiguous — `old_string` appears N times." Same disabled-Approve / Reject / respondWith treatment.
   - **Unique match.** Render the diff (below). Approve + Reject both enabled.
4. **Diff rendering.** Expand the unique match to the boundary lines that contain it. Capture two lines of unchanged context above and two below (clipped at file start/end). Within the changed region, run `diffWords` from the `diff` package and render with red strikethrough on removed segments and green background on added segments. A small line-number gutter on the left starts at `firstContextLineNumber` and increments per rendered line, reflecting the source's line numbers (not 1-based-from-card).
5. **Header line.** "Edit *editor*" or "Edit *`/path/to/file.py`*" depending on tool. The path comes from `args.path` for device edits.
6. **Buttons.** Approve / Reject. Approve calls `approval.approve()`. Reject calls `approval.reject()`.

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

### `ToolBindings` — no new fields

`edit_editor` only needs the existing `getEditorContent` and `setEditorContent`. `edit_device_file` only needs the existing `deviceFs`. No new binding required.

### `wireTools.ts`

Register two new tools alongside the others:

```ts
tools.register(new EditEditorTool(get));
tools.register(new EditDeviceFileTool(get));
```

### `CODING_AGENT.tools` (in `src/agent/config.ts`)

Add `'edit_editor'` and `'edit_device_file'` to the `tools` list.

### `CODING_AGENT.instructions`

Add a paragraph that steers the model toward `edit_*` for partial changes and away from `write_*` for them. Sketch:

> "For partial changes to existing code, prefer `edit_editor` (or `edit_device_file` for a file on the device) — they take an `old_string` / `new_string` and require uniqueness, and the user reviews a focused diff. Use `write_editor` only when creating a new program from scratch or replacing the whole buffer; use `write_device_file` only for new files or full rewrites. Both `edit_*` and `write_*` tools require user approval before they apply."

The existing description of `write_editor` ("When asked to write code, use write_editor then offer to run it.") is rewritten so the default partial-edit path is `edit_editor`.

### `<AgentProvider>`

No new props needed. The default `onApprovalRequired` is already "INLINE_APPROVAL for every approval-required call." We pass `renderApproval` through to `<ConversationPanel>`, not to `<AgentProvider>`.

---

## File map

**Add:**

- `src/agent/tools/EditEditorTool.ts`
- `src/agent/tools/EditEditorTool.test.ts`
- `src/agent/tools/EditDeviceFileTool.ts`
- `src/agent/tools/EditDeviceFileTool.test.ts`
- `src/components/CobwebApproval.tsx` (dispatcher + the three card components)
- `src/components/CobwebApproval.test.tsx` *(see Testing — the three card components are pure functions of `entry` + bindings; component-level rendering tests are skipped per project convention, but the dispatch logic and "edit no longer applies" branches are covered by extracting a pure helper to `src/lib/editApproval.ts` with its own `.test.ts`.)*
- `src/lib/editApproval.ts` — pure helpers: `findUniqueOccurrence(source, target): { kind: 'unique'; index: number } | { kind: 'missing' } | { kind: 'ambiguous'; count: number }`, `expandToContextLines(source, matchIndex, matchLength, contextLines): { before: string[]; old: string[]; new: string[] (computed by caller); after: string[]; firstLineNumber: number }`.
- `src/lib/editApproval.test.ts`

**Modify:**

- `src/agent/tools/WriteEditorTool.ts` — flip `requiresApproval` to `true`; tighten description.
- `src/agent/wireTools.ts` — register the two new tools.
- `src/agent/config.ts` — add tool names; rewrite the partial-edit guidance paragraph.
- `src/components/AgentPanel.tsx` — accept `renderApproval` prop; forward to `<ConversationPanel>`.
- `src/App.tsx` — build the `renderApproval` closure with bindings; pass to `<AgentPanel>`.

**No change:**

- `src/agent/tools/WriteDeviceFileTool.ts`, `DeleteDeviceFileTool.ts`, `MakeDeviceDirTool.ts` — they already flag `requiresApproval: true`; they automatically pick up the approval flow once the renderer is in place.

**Dependencies:**

- Add `diff` (the `jsdiff` package — `import { diffWords } from 'diff'`). No `react-diff-viewer` or similar.

---

## Testing

Per project convention, UI components are not unit-tested. The pure logic is — that is where bugs hide:

- `src/lib/editApproval.test.ts` — `findUniqueOccurrence`: empty target, single match at start / middle / end, zero matches, two matches, overlapping matches (e.g. `target = 'aa'`, `source = 'aaaa'` → counted by non-overlapping replace semantics, matching `String.prototype.replace`'s behaviour). `expandToContextLines`: match at file start (no `before` lines), match at file end, match spanning the whole file, multi-line matches (the entire matched region is shown line-aligned).
- `src/agent/tools/EditEditorTool.test.ts` — mock bindings; verify `not found`, `ambiguous`, `unique` paths return the expected strings and call `setEditorContent` only on the unique path.
- `src/agent/tools/EditDeviceFileTool.test.ts` — mock `DeviceFs`; verify `'Device is not connected.'`, binary-file rejection, the three find-replace branches, and the success path calls `writeText` with the replaced content.

The renderer dispatch and "edit no longer applies" handling are validated end-to-end via manual browser testing against the success criteria in the PRD.

---

## Phasing / Issue Breakdown

This feature ships behind the GitHub label `tool-approval`. Each item below becomes its own issue / PR.

1. **Docs.** PRD + SPEC + GitHub label + epic issue. (This issue / PR; not a code change.)
2. **`edit_editor` + diff approval renderer.** Adds `EditEditorTool`, `editApproval` helpers + tests, `CobwebApproval` dispatcher, `EditApprovalCard`. Flips `WriteEditorTool.requiresApproval` to `true` and adds a placeholder `WriteApprovalCard` that just shows "Replace editor with new content" + Approve/Reject (no preview yet — kept minimal so this PR is single-purpose). Wires `renderApproval` into `<AgentPanel>` and `<ConversationPanel>`. Updates `CODING_AGENT.instructions` for `edit_editor` only.
3. **`edit_device_file` + diff approval for it.** Adds `EditDeviceFileTool` + tests; extends the dispatcher to render `EditApprovalCard` for it (async source read). Updates instructions.
4. **Confirmation cards.** Replaces the placeholder `WriteApprovalCard` with the scrollable preview; adds `ConfirmApprovalCard` for `delete_device_file` and `make_device_dir`. (Depends on #2.)
5. **Polish + verification.** Manual cancel/reset testing during a pending approval; verify no orphaned promises survive; tighten copy on cards based on the live UX. (Depends on #2-4.)

Each issue body should reference this SPEC by section and state `Depends on #N` for explicit dependencies.

---

## Open Questions

- **Approve-all toggle.** PRD calls it out of scope. If users ask, the cleanest extension point is `<AgentProvider approvalOverride={['!edit_editor']}>` (suppress approval for one tool at runtime). We do not need a custom `onApprovalRequired` for this.
- **Multi-edit tool.** Claude Code has a `MultiEdit` that batches several `old_string` / `new_string` pairs against the same buffer. Out of scope for v1; if it appears, it gets its own diff renderer that stacks per-pair diffs in one card.
- **Diff styling.** v1 uses `diffWords`. Line-level diffing (`diffLines`) is an alternative for code; we prefer word-level since edits are typically tight. Revisit if the rendered diff is hard to read for whitespace-heavy languages.
