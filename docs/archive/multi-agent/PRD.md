# Multi-agent Architecture — Product Requirements Document

## Problem Statement

The current Cobweb assistant runs as a single agent (`CODING_AGENT` in `src/agent/config.ts`) that interleaves task understanding with execution. On non-trivial requests it spends two to five read-shaped tool calls (`read_editor`, `list_device_files`, `get_board_info`, …) gathering state before the first edit, and that exploration history then stays in context for every subsequent turn. Two consequences:

- **Context bloat.** A single short editing request can leave behind thousands of tokens of preamble that subsequent turns have to re-read.
- **Decision quality drift.** As the conversation grows, the model has to reason over an increasingly noisy history, which degrades editing accuracy later in long sessions.

Splitting the role into a planner (read-only, scopes the work) and a coder (execution, runs with a tight context per delegation) bounds the coder's context to one task at a time and keeps the user-facing thread focused on planner-level decisions.

## Target Users

Same as the parent PRD (educators, hobbyists, beginners). Scenarios this feature unlocks:

- **Hobbyist** asks "add a button debounce to `main.py`". Planner reads the file, scopes a one-line work order, and the coder runs with that order against an empty conversation slate.
- **Educator** asks a multi-step task: "read `sensor.py`, add LED feedback, then test it." Planner sequences two `delegate_to_coder` calls; each coder run starts with a clean context.
- **Beginner** asks "what board am I on?" Planner answers from `get_board_info` alone — no delegation, no editing context loaded.

## Goals

1. **Planner / coder split.** Add a `PLANNING_AGENT` whose tool allowlist is read-only plus `delegate_to_coder`. Keep `CODING_AGENT` for execution.
2. **Per-message routing through the planner.** Every user turn enters via the planner. Trivial questions are answered directly; anything that mutates state goes through `delegate_to_coder`.
3. **Transparent sub-agent UI.** The user sees the planner's tool calls inline and the coder's tool calls (including approval prompts) nested under the `delegate_to_coder` entry. No separate panel, no hidden execution.
4. **No new framework code.** Use `createAgentTool()` from `@mast-ai/core` and the existing nested rendering in `@mast-ai/react-ui`.
5. **Reusable sub-agent registration pattern.** The mechanism that registers `delegate_to_coder` (a `createAgentTool` wrapping an `AgentConfig`, registered once a runner exists) is the same mechanism future sub-agents will use. The immediate next consumer is the `search_documentation` sub-agent in epic #141, which wraps a separate `AgentRunner` configured with Gemini's native `googleSearch` tool. Adding it must require only a new `AgentConfig`, one more registration line, and — if it needs a different adapter — a separate `AgentRunner` construction. No further `App.tsx` rewire.

## Out of Scope

- Additional tools beyond `delegate_to_coder` (covered by the `agent-tools` epic).
- MicroPython documentation context injection (separate `docs-context` epic, #141). This epic establishes the multi-agent infrastructure #141 will build on, but does not inject docs itself. Note for #141's author: keeping `PLANNING_AGENT` and `CODING_AGENT` as distinct `AgentConfig` exports means their `instructions` strings can be augmented independently, which is the natural injection point for the planner-vs-coder context split #141 needs (board profile and import list to the planner; full RST module docs to the coder).
- Persisted planner / coder split metrics (token use, delegation count) — possible future work.
- Routing heuristics or user-facing affordances to bypass the planner (e.g. a "/coder" prefix). The planner is the sole entry point.

## Success Criteria

- A trivial query ("what board am I on?") completes without invoking `delegate_to_coder`.
- A request that requires editing the buffer routes: user → planner → `delegate_to_coder` → coder → `edit_editor` (with the existing approval modal still firing) → applied diff. The approval card looks and behaves identically to today.
- The conversation panel shows planner tool calls at top level, with the coder's tool calls and approval prompts visibly nested inside the `delegate_to_coder` entry.
- A multi-step request results in two or more `delegate_to_coder` calls in a single planner turn, each with its own scoped task string.
- A new sub-agent (e.g. #141's `search_documentation`) can be added by introducing a new `AgentConfig`, one additional registration call in the existing sub-agent-registration `useEffect`, and — if it needs a different adapter — a separate `AgentRunner` construction. No changes to `<AgentProvider>`, `wireTools`, or the conversation panel.
- `npm run lint`, `npm run test`, `npm run build` all pass with no new framework dependencies.

## Considered alternatives

### Coordinator + advisor agents (rejected)

An alternative shape: a top-level **coordinator** owns all write tools; **planner** and **coder** are read-only sub-agents that return text (a plan, drafted code) which the coordinator then enacts via its own tool calls. Considered because it offers a single approval surface (all writes attributed to the main agent, no nested approvals) and naturally serialises writes (concurrency for free).

Rejected because:

- **The original problem returns.** The Problem Statement is context bloat in the persistent agent. Coordinator-as-writer moves every edit, every `run_editor`, every approval, every debug-loop tool call back into the persistent (coordinator) agent's history. The coder's clean slate is preserved but the coordinator's history bloats — which is the state we are leaving.
- **The coder stops being a coder.** It can no longer call `edit_editor` / `run_editor` directly; it returns text describing the intended edit, which the coordinator then has to parse and re-issue as a tool call. We lose the structured tool-call interface end-to-end and add a re-interpretation step that is itself a failure surface.
- **Debug loops cross the coordinator boundary.** Today's coder can write → run → read stderr → fix in one bounded delegation. Under the coordinator design, every iteration becomes a coordinator round-trip carrying the run output back to the coder, multiplying turns and tokens.

The two real benefits — single approval surface and concurrency — are addressable in the planner-as-main design: nested approvals can be made legible by surfacing the parent delegation task on the approval card if browser testing shows confusion, and concurrency has a small targeted mitigation (see SPEC §5). Goal 5's reusable registration pattern does not foreclose adopting the coordinator shape later if observed reality justifies it.
