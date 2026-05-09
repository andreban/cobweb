# Multi-agent Architecture — Technical Specification

## Overview

`@mast-ai/core` v0.5.0 already provides every primitive this epic needs. We are not extending the framework — we are configuring it.

- `createAgentTool()` (`node_modules/@mast-ai/core/dist/agentTool.d.ts`) wraps an `AgentConfig` as a `Tool`, so a parent agent can invoke a sub-agent as just another tool call.
- Sub-agent runs share the parent's `AgentRunner` and `ToolRegistry`. Per-agent tool visibility is filtered by the `AgentConfig.tools` allowlist (`runner.js:140-149`).
- `RunBuilder.forwardTo(parentContext)` (`runner.js:54-57`), which `createAgentTool` calls internally, forwards every non-`done` child event to the parent's `context.onEvent`. The parent's UI populates `subText` / `nestedContentBlocks` automatically.
- `@mast-ai/react-ui`'s `ConversationPanel` already renders `ToolEventEntry.nestedContentBlocks` (interleaved sub-agent thinking and nested tool events in source order). Approvals for write tools called by the sub-agent flow through the same `AgentProvider.onApprovalRequired`, because the sub-agent runs on the same registry.

The work in this SPEC is therefore: a new agent config, a thin tool factory, an `App.tsx` rewire, and a browser verification pass.

---

## 1. `PLANNING_AGENT` — config + instructions

### `src/agent/config.ts`

Add a `PLANNING_AGENT` export alongside `CODING_AGENT`. Keep `CODING_AGENT` exactly as it is today — it remains the executor; only its caller changes.

**`AgentConfig`:**

- `name: 'cobweb-planner'`
- `tools: ['read_editor', 'read_device_file', 'list_device_files', 'read_repl_history', 'get_board_info', 'delegate_to_coder']`
- `instructions`: short, focused on the routing contract. No editing rules. Draft:

  > "You are a MicroPython coding assistant for the Cobweb IDE. You have read-only access to the editor, the device filesystem, the REPL history, and board info, plus a `delegate_to_coder` tool that hands work to a coder sub-agent.
  >
  > For trivial questions you can answer from the read-only tools (e.g. board info, file listings, current editor contents), answer directly without delegating.
  >
  > For any task that requires changing the editor, the device filesystem, or running code, call `delegate_to_coder` with a self-contained `task` string. The coder starts each call with no conversation history, so the task string must stand alone — but it does have the same read tools as you (`read_editor`, `read_device_file`, `list_device_files`, `read_repl_history`, `get_board_info`). Refer to files by path and let the coder read them; do not paste file contents into the task string. Include only what the coder cannot reconstruct from reading: the user's intent, exact constraints (line numbers, function names, before/after behaviour), and success criteria.
  >
  > Multi-step requests can call `delegate_to_coder` multiple times in one turn. After each delegation, briefly summarise what was done before deciding the next step."

**`run_snippet` is coder-only.** The planner's allowlist excludes it. Rationale: `run_snippet` is approval-gated (`requiresApproval: true`), executes arbitrary code on the device, and counts as a user-visible state change. Keeping it off the planner preserves the planner = read-only / coder = write boundary. The most common probe use cases (firmware / platform / RAM) are covered by `get_board_info`; ad-hoc "evaluate this expression" requests delegate, which gives the user a visible audit trail.

### Tests

No new test file for the agent config itself — `AgentConfig` is plain data. The factory in §2 has its own tests.

---

## 2. `delegate_to_coder` — agent-tool factory

### `src/agent/tools/DelegateToCoderTool.ts`

Exports a factory `createDelegateToCoderTool(runner: AgentRunner): Tool` that wraps `CODING_AGENT` via `createAgentTool`. The factory shape exists because `createAgentTool` requires a runner reference, which doesn't exist when `wireTools` runs (`wireTools` is bindings-only and called during render before the runner `useMemo` resolves).

**Body:**

```ts
import { createAgentTool, type AgentRunner, type Tool } from '@mast-ai/core';
import { CODING_AGENT } from '../config';

export function createDelegateToCoderTool(runner: AgentRunner): Tool {
  return createAgentTool(runner, CODING_AGENT, {
    name: 'delegate_to_coder',
    description:
      'Hands a scoped, self-contained task to the coder sub-agent. Use for any work that requires editing the editor, the device filesystem, or running code on the device. The coder starts with no conversation history, so the task string must include all required context (paths, constraints, success criteria).',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Self-contained instruction for the coder. Include relevant file paths, exact constraints, and success criteria.',
        },
      },
      required: ['task'],
    },
    scope: 'write',
    buildInput: (args) => (args as { task: string }).task,
  });
}
```

**Coder context: clean slate, no history.** `buildInput` returns only the `task` string; the coder receives that as its single user message and starts with no prior conversation history. Rationale: this is the design that delivers the Problem Statement's goal of bounded coder context per delegation. Selected-history forwarding (via `RunBuilder.history(...)`) was considered and rejected because it reintroduces the bloat the epic exists to remove.

To keep the `task` string itself small, the planner is instructed (§1) to refer to files by path and rely on the coder's read tools rather than pasting file contents inline. The coder's allowlist (the existing `CODING_AGENT.tools`) is a superset of the planner's read tools, so anything the planner could read, the coder can read too. The `task` string carries only what cannot be reconstructed by reading — user intent, exact constraints, success criteria.

**Approval boundary: innermost write, not delegate.** `delegate_to_coder` has `scope: 'write'` (delegating is a state-changing intent) but **does not** set `requiresApproval: true`. Approval modals fire only when the coder calls a write tool with its own `requiresApproval: true` flag (`edit_editor`, `run_editor`, `write_device_file`, etc.), nested inside the delegate entry. Rationale: approval cards are most useful at the action boundary, where the user sees an actual diff or content preview — approving a natural-language task description before the coder has chosen its actions is a weaker safeguard. If repeated inner approvals during one delegation become an ergonomic burden in practice, the right answer is a "trust the rest of this delegation" affordance on the first inner approval card, not an extra approval at the boundary; that is UI work for the conditional issue C, not a structural choice locked here.

### Tests — `src/agent/tools/DelegateToCoderTool.test.ts`

- `definition()` returns the expected name (`delegate_to_coder`), `scope: 'write'`, and a `parameters` schema with a required `task: string`.
- Calling the tool with `{ task: 'foo' }` invokes the runner's `runBuilder(CODING_AGENT)` and yields `'foo'` as the input. (Stub `AgentRunner` whose `runBuilder` returns a chainable builder; assert `runStream` receives `'foo'`.)
- Sub-agent events emitted by the stub builder (e.g. `text_delta`, `tool_call_started`) are forwarded to `context.onEvent`.
- The tool's resolved value is the `done` event's `output` from the stub builder.

### File map

**Add:**
- `src/agent/tools/DelegateToCoderTool.ts`
- `src/agent/tools/DelegateToCoderTool.test.ts`

**Modify:**
- `src/agent/config.ts` — add `PLANNING_AGENT` export.

---

## 3. `App.tsx` — rewire the entry point and register the delegate tool

### Changes

1. Import `PLANNING_AGENT` and `createDelegateToCoderTool`.
2. After the existing `runner = useMemo(() => new AgentRunner(...))` block, register `delegate_to_coder` on `models.tools`. Registration must be idempotent and depend on `runner`:

   ```ts
   useEffect(() => {
     if (!runner) return;
     if (models.tools.getTool('delegate_to_coder')) return;
     models.tools.register(createDelegateToCoderTool(runner));
   }, [runner]);
   ```

   Rationale for `useEffect` rather than a plain assignment in render: `models.tools.register` mutates the registry; doing it in render would re-register on every render and (per the framework) throw on duplicates. The `getTool` guard handles React Strict Mode's double-effect.

3. Change `<AgentProvider agent={CODING_AGENT}>` → `<AgentProvider agent={PLANNING_AGENT}>`.

4. `onApprovalRequired` is unchanged. The existing `INLINE_APPROVAL` default applies to every flagged tool, including those invoked by the sub-agent (same registry). The `open_device_file_in_editor` / `save_editor_to_device` device-disconnected guard at lines 333–340 stays — it triggers only when those tools are called, regardless of which agent called them.

**Per-message routing through the planner.** Every user turn enters `PLANNING_AGENT`; the planner decides whether to answer directly or delegate. The trivial-query cost is one extra LLM round-trip with a short system prompt and no tool calls. Routing heuristics and bypass affordances (e.g. a `/coder` prefix) are explicitly excluded by the PRD's Out of Scope section — one rule, one mental model. If observed sessions show the trivial-query cost is annoying, a bypass can be added later without re-architecting (the sub-agent registration pattern is unchanged).

### File map

**Modify:**
- `src/App.tsx` — add the `useEffect` registration; switch the `agent` prop on `<AgentProvider>`.

---

## 4. UI — verification, not implementation

`ConversationPanel` already renders nested tool events. The plan is to verify in the browser that:

- The planner's `read_editor` etc. show as top-level tool entries.
- The coder's `edit_editor` etc. show nested under the `delegate_to_coder` entry.
- The approval modal for nested write tools (`edit_editor`, `run_editor`) fires identically to today.
- Sub-agent thinking and nested tool events from the coder (carried via `nestedContentBlocks` and `subText`) render legibly inside the delegate entry, interleaved in source order.

If nesting renders poorly (cramped layout, no visual differentiation, hard to tell which tool belongs to which agent), file follow-up issue C with a specific UI ask. Do **not** pre-emptively customise `renderToolCall` or `getToolLabel`.

---

## 5. Concurrency considerations

### Background

`AgentRunner` runs all tool calls within a single LLM turn via `Promise.all` (`runner.js:200-220`). With the planner / coder split, this means the planner can in principle emit two `delegate_to_coder` calls in one turn, spawning two concurrent coder loops that share the same editor, the same `DeviceFs`, and the same `ReplInterface`. Failure modes if it happens:

- **Stomped editor edits.** Both coder runs read the same buffer; A's `replaceEditorRange` invalidates B's offsets; B's `edit_editor` applies at a stale offset or fails uniqueness against changed surrounding context.
- **Duplicate `run_editor`.** A starts a program; B's `run_editor` sends Ctrl-C + raw-mode entry, killing A's program. The wire serialises (`ReplInterface.send` is end-to-end mutex'd) but the *intent* doesn't.
- **Approval queue ambiguity.** Two pending approvals from "the coder" with no obvious ordering — UX gets confusing fast.

### Pre-existing risk (out of scope)

Concurrent tool calls *within* a single coder run (the coder's LLM emits two `edit_editor`s in one round) is the same risk as the current single agent and is unchanged by this epic.

### Mitigation — designed but not implemented

If parallel `delegate_to_coder` is observed, serialise at the tool boundary inside `DelegateToCoderTool.ts`:

```ts
export function createDelegateToCoderTool(runner: AgentRunner): Tool {
  const inner = createAgentTool(runner, CODING_AGENT, { /* … as in §2 */ });
  let chain: Promise<unknown> = Promise.resolve();
  return {
    definition: inner.definition,
    call: (args, context) => {
      const next = chain.then(() => inner.call(args, context), () => inner.call(args, context));
      chain = next.catch(() => {});
      return next;
    },
  };
}
```

This serialises only `delegate_to_coder` against itself; the planner can still parallelise `read_editor` + `delegate_to_coder` without penalty. Test by stubbing the inner tool with a deferred promise, kicking off two concurrent calls, and asserting the second's `inner.call` is not invoked until the first resolves.

### Decision

**Not implementing in the initial PRs (issues A, B).** Rationale:

- We have not observed parallel `delegate_to_coder` in this codebase because the tool does not yet exist. The planner instructions ("after each delegation, briefly summarise") bias toward serial execution. Heavyweight tools tend to be issued sequentially by the model.
- The failure mode is loud — stomped edits or fighting `run_editor` calls would surface within minutes of browser testing.
- The mitigation is small, self-contained, and equally cheap to add later.

If issue B's browser test (or any later session) shows parallel delegation, file a follow-up issue and apply the snippet above. Documenting the mitigation here means the design is ready when needed.

---

## Issue breakdown

| Issue | Title | Files added | Files modified |
|-------|-------|-------------|----------------|
| A | `PLANNING_AGENT` config + `delegate_to_coder` tool factory | `src/agent/tools/DelegateToCoderTool.ts`, `.test.ts` | `src/agent/config.ts` |
| B | Switch entry point to `PLANNING_AGENT` | — | `src/App.tsx` |
| C | (Conditional) UI polish for nested tool entries | — | TBD after #B browser test |

A is independent and can land on its own — `delegate_to_coder` is registered but unused until B switches the entry point. B depends on A. C is created only if #B's browser test surfaces a UI gap.

**Phasing: A and B ship as separate PRs.** A lands as dead code at runtime (the factory exists and the planner config is exported, but nothing registers the tool or routes through `PLANNING_AGENT`). B follows promptly to make the code live; the dead-code interim resolves the moment B merges. No separate cleanup issue is needed — B *is* the cleanup. Rationale for splitting: the user's standing preference is small PRs, B's review is browser-test-driven and benefits from isolation, and a future revert (e.g. if nested approvals turn out to be unworkable) can drop just B and keep the factory plumbing for a re-architected entry-point.

**Branching strategy (epic-specific override of CLAUDE.md):** Sub-issues do **not** branch off `main`. Instead:

- A long-lived `multi-agent` integration branch is created off `main` once, before issue A is taken up.
- Each sub-issue branches off `multi-agent` (e.g. `feat/multi-agent/planner-config`) and opens its PR against `multi-agent` (`gh pr create --base multi-agent`).
- `multi-agent` is merged into `main` only when the entire epic is verified end-to-end. Until then the feature can be abandoned wholesale by deleting the branch, without per-sub-issue reverts.

This applies for the duration of this epic only; CLAUDE.md's default (branch off `main`, PR against `main`) resumes for unrelated work.
