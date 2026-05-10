# MicroPython Documentation and Board-Specific Context Injection — Product Requirements Document

## Problem Statement

The Cobweb coding agent has no access to MicroPython stdlib documentation, board-specific context (pinouts, available peripherals, vendor modules), or any memory of work done on a board in previous conversations. Three failure modes follow:

- **Unreliable answers from training prior.** Niche boards and infrequently used MicroPython modules are sparsely covered by the model's training data. The agent confidently emits API signatures that don't exist on the connected firmware (wrong argument names, wrong return types, CPython behaviour where MicroPython diverges).
- **Context churn from runtime probing.** When the agent compensates by running `dir(module)` / `help(module)` snippets through `run_snippet`, each probe burns a tool call, an approval prompt, and conversation tokens — and produces output the model has to parse before answering.
- **No cross-thread memory.** Each new conversation starts blank. Anything the agent learned in a previous thread (the user's board has a `presto` module, the docs are at a particular Pimoroni repo, certain pins are wired to the touch panel) is lost. The user has to re-establish context every session.

The `agent-tools` epic added a `get_board_info` probe that returns the firmware string, platform, free RAM, and `os.uname().machine` at session start. That gives the agent the board *identity* but not the *capabilities* (which modules are installed, where vendor docs live, what's been useful before).

## Target Users

Same as the parent PRD (educators, hobbyists, beginners). Scenarios this feature unlocks:

- **Hobbyist with a Pimoroni Presto** asks "set up the display." The agent calls `list_installed_modules`, discovers `presto`, `picographics`, `plasma`. It calls `read_board_notes` and finds a URL the user pasted in a previous thread (`https://github.com/pimoroni/presto`). It calls `fetch_url` on that URL, reads the README, writes the working snippet — without the user re-explaining anything.
- **Educator** connects a Raspberry Pi Pico and asks for an LED blink. The agent calls `read_board_notes`; nothing yet. It writes the working code from training prior, then `edit_board_notes` to record the GP25 onboard-LED note for next time.
- **Beginner** pastes `https://github.com/adafruit/Adafruit_CircuitPython_NeoPixel` and asks "use this." The agent calls `fetch_url`, reads the API, writes code, and saves the URL to notes so the next session knows where to look.

## Goals

1. **Per-board persistent notes.** Add `read_board_notes`, `write_board_notes`, and `edit_board_notes` tools backed by `localStorage` keyed on `os.uname().machine`. The agent maintains a freeform markdown blob per board: vendor module surface, useful docs URLs, pin assignments, gotchas. Persists across page reloads and across conversations.
2. **Generic URL fetching.** Add `fetch_url(url)` — accepts any URL, returns the body or a descriptive error string (CORS, 404, network). GitHub repo URLs auto-translate to `raw.githubusercontent.com` so pasted repo links resolve to README content. No caching in phase 1; every call hits the network.
3. **Module-surface introspection.** Add `list_installed_modules` — runs `help('modules')` on the device and returns the list. Lets the agent learn what's actually available on the connected firmware (including vendor extensions like `presto`, `picographics`, etc.) without trial-and-error.
4. **Coder-only allowlist for the new tools.** All three tools serve code generation, which is the coder's job. The planner stays lean — it routes work, it does not need API references or board memory.
5. **Lean system prompts.** No injection. The new tools each get one nudge sentence in the coder's instructions — `read_board_notes` at the start of work, `list_installed_modules` when capabilities are uncertain, `fetch_url` for user-provided or notes-recorded URLs. Tool descriptions carry the bulk of the "when to call" guidance.

## Out of Scope

### Deferred to phase 2 (future work)

- **Typed doc tools (`get_board_quickref`, `get_module_docs`).** Convenience wrappers around `fetch_url` with hardcoded URL patterns for upstream MicroPython docs. Add only if browser observation shows the model under-fetches when given the generic `fetch_url` plus URL hints in its instructions.
- **`search_documentation` sub-agent.** Gemini-grounded web search via the native `googleSearch` tool. Genuinely useful as the fallback when `fetch_url` hits CORS, but provider-locked to Gemini and not foundational. Lands on its own once phase 1 is observed.
- **Caching of fetched URLs.** Phase 1 hits the network on every `fetch_url` call. When typed doc tools land (or if observed network traffic from repeated fetches becomes a problem), a shared fetcher utility with Cache API caching — and likely firmware-version-keyed namespacing — gets introduced.

### Not planned

- **Pre-injecting docs into system prompts.** Considered and rejected (see "Considered alternatives").
- **Auto-capture of fetched URLs into board notes.** Considered; the agent decides what's worth remembering. See "Considered alternatives".
- **Vendor-aware fetcher routes** (e.g. detect "Pimoroni" in machine name, fall back to a Pimoroni-specific docs site). Adds maintenance per vendor; user-pasted URLs + board notes solves the same problem generically.
- **Per-session user-provided notes via UI** (a "context panel" the user types into). The chat *is* the input channel — the agent records what the user mentions. UI affordances for managing notes outside chat are a possible follow-on.
- **Cross-board notes.** Notes are scoped per `os.uname().machine`. Two physically distinct boards with the same machine string share notes; if that's confusing in practice, disambiguation UI is a follow-on.

## Success Criteria

- After connecting a board and starting a conversation, the agent can call `read_board_notes` and receive the saved markdown for that board (or `""` if none yet).
- After the agent calls `write_board_notes(content)` or `edit_board_notes(old, new)` and the user approves, refreshing the page and starting a new conversation surfaces the same notes via `read_board_notes`.
- Notes for one board (`os.uname().machine == "Raspberry Pi Pico"`) do not leak into another board (`"Pimoroni Presto with RP2350"`).
- The agent can call `fetch_url("https://github.com/pimoroni/presto")` and receive the README contents in the tool result.
- A `fetch_url` call against a CORS-rejecting host returns a clear string the agent can read and reason about; no unhandled rejection bubbles up.
- The agent can call `list_installed_modules` and receive the `help('modules')` listing as text. On a Pimoroni Presto this includes `presto`, `picographics`, etc.; on a stock Pico it includes only the standard set.
- The planner does not have any of the three new tools in its allowlist.
- Writes to notes (`write_board_notes`, `edit_board_notes`) trigger the existing approval flow — the user sees what's about to be saved before it's saved.
- `npm run lint`, `npm run test`, `npm run build` all pass. No new top-level dependencies (Cache API and `localStorage` are platform built-ins).

## Considered alternatives

### Pre-inject docs into the system prompt at connect / per turn (rejected)

Probe at connect, scan editor imports per turn, mutate `agent.instructions` with assembled context. Pros: guaranteed presence. Cons: every turn pays the injection cost, defeats prompt caching at the provider level, and forces deterministic decisions ("which modules are imported *right now*") that don't necessarily match what the agent actually needs to look up.

Tools-on-demand accepts a structural risk — the model has to *decide* to call the tool — and mitigates it via concise tool descriptions and a brief nudge in the coder's system prompt. If observation shows the model under-calls, the system prompt nudge can be tightened without changing the tool surface.

### Restrict `fetch_url` to GitHub only (rejected)

Phase 1 originally proposed limiting `fetch_url` to GitHub URLs because CORS-handling for arbitrary hosts is unpredictable. Replaced with: accept any URL, surface failures (CORS, 404, network) as readable strings the agent can act on. The agent can fall back to asking the user to paste content directly, or to a future `search_documentation`. This matches the rest of the tool design (`get_module_docs` returns a "no docs found" string the agent reasons about, not an error).

GitHub-URL translation is kept as a usability nicety (`github.com/owner/repo` → `raw.githubusercontent.com/owner/repo/main/README.md` etc.) — not a restriction.

### Auto-capture fetched URLs into board notes (rejected)

Earlier draft proposed automatically appending every successful `fetch_url` to a per-board URL list. Replaced with agent-managed notes: the agent decides what's worth recording. Tradeoff: less deterministic (the model might under-record), but notes stay curated rather than polluted with every transient fetch. If observation shows under-recording, the system-prompt nudge tightens; the structural design doesn't change.

### Vendor-aware fetcher routes (rejected)

Detect "Pimoroni", "Adafruit", etc. in `os.uname().machine` and route module lookups to vendor-specific docs sites first. Adds per-vendor maintenance, and the user-pasted-URL-plus-notes path solves the same problem generically.

## Key questions to resolve in the SPEC

- Where does `machineName` (from `os.uname().machine`) get captured and exposed? Connect-time hook? Lazy on first tool call?
- What's the localStorage layout for notes (key naming, value format, size cap)?
- How does the approval flow render note edits — reuse the existing `edit_editor` approval card layout, or build something custom?

## Constraints

- No backend; all fetches must be client-side (satisfied by `raw.githubusercontent.com`'s `Access-Control-Allow-Origin: *` for the GitHub-translation case; arbitrary hosts may CORS-reject and that's surfaced to the agent).
- Tool-result size cap: ~30 KB per fetched body, with a `[truncated]` marker pointing at the source URL when capped.
- Notes per board cap: ~64 KB. Far more than the agent will reasonably write; protects localStorage from runaway growth.
- localStorage must survive page reloads (it does by default).
- No system-prompt mutation. The `instructions` strings on `PLANNING_AGENT` and `CODING_AGENT` are written once at module load.
