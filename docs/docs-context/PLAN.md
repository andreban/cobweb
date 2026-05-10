# MicroPython Documentation and Board-Specific Context Injection — Implementation Plan

Operational notes for executing the SPEC. Step-by-step ordering, branch names, and per-issue verification. The PRD/SPEC are the source of truth for *what* and *why*; this file is *when* and *how*.

## Pre-flight

- Parent epic: [#141](https://github.com/andreban/cobweb/issues/141).
- Label: `docs-context` (exists).
- Branching: each issue lands as its own PR off `main`. No long-lived integration branch — the feature is additive and self-contained.
- The mast-ai dependency for phase 2's `search_documentation` (`nativeTools` constructor parameter) already shipped in `@mast-ai/google-genai@0.8.0` and is on the project. No upstream coordination required for any phase 1 issue.

## Issue ordering

A, B, C are independent and can land in any order or in parallel. Suggested sequence by user-visible value:

1. **A — Board notes + `machineName` capture.** Highest leverage — solves cross-thread memory immediately and exposes `machineName` in `ToolBindings`. Touches `App.tsx`, `wireTools.ts`, `config.ts`, and adds a hook + three tools.
2. **B — `fetch_url`.** Generic URL fetch. Standalone tool, no bindings extension. Smallest blast radius.
3. **C — `list_installed_modules`.** Smallest probe tool. Closely mirrors `GetBoardInfoTool`'s shape.

If parallelising, A goes first because it touches `App.tsx` and `wireTools.ts`; B and C then layer on with smaller diffs.

## Per-issue execution

For each issue:

1. `git checkout main && git pull`.
2. Create the feature branch (`git checkout -b feat/docs-context/<slug>`).
3. Implement per the SPEC's "File map" subsection.
4. Run `npm run lint && npm run test && npm run build`. Fix failures.
5. Ask the user to test in the browser per the SPEC's UI verification subsection. Wait for confirmation before committing.
6. Commit with the PR-description-style message (subject + body).
7. Push and `gh pr create --base main` with a body including `Closes #<issue>`.

### A — Board notes + `machineName` capture

- Branch: `feat/docs-context/board-notes`
- Slugs to add to `CODING_AGENT.tools`: `read_board_notes`, `write_board_notes`, `edit_board_notes`.
- Order of work within the issue:
  1. `useMachineName` hook + test.
  2. Extend `ToolBindings` interface; wire the new field through `App.tsx`.
  3. Add the three tools (`BoardNotesReadTool`, `BoardNotesWriteTool`, `BoardNotesEditTool`) + tests.
  4. Register in `wireTools`; allowlist in `CODING_AGENT.tools`.
  5. Add the coder-instructions nudge sentence.
- Verification (SPEC §7 A): write a note → refresh → read returns the saved content; switch boards → no leakage.

### B — `fetch_url`

- Branch: `feat/docs-context/fetch-url`
- Order of work:
  1. URL translation helper (`translateGitHubUrl`) — pure function, easy to unit-test.
  2. `FetchUrlTool` + test (stub `fetch` on `globalThis`).
  3. Register in `wireTools`; allowlist in `CODING_AGENT.tools`.
  4. Add the coder-instructions nudge sentence.
- Verification (SPEC §7 B): paste a Pimoroni repo URL → README returned; CORS-rejecting URL → readable error string; `blob/` URL → translated to raw and fetched.

### C — `list_installed_modules`

- Branch: `feat/docs-context/list-installed-modules`
- Order of work:
  1. `ListInstalledModulesTool` (mirrors `GetBoardInfoTool`'s probe + timeout shape) + test.
  2. Register in `wireTools`; allowlist in `CODING_AGENT.tools`.
  3. Add the coder-instructions nudge sentence.
- Verification (SPEC §7 C): connect a Pico → tool fires, output includes stdlib modules; on a vendor board, output includes vendor modules.

## Cross-cutting checks (each PR)

- The new tool name appears in `CODING_AGENT.tools` and *not* in `PLANNING_AGENT.tools`.
- The coder-instructions nudge is appended to the existing `instructions` literal — no per-turn mutation.
- Tool definitions correctly set `scope` (`'read'` for reads, `'write'` for the two notes writers) and `requiresApproval` (`true` for the writes).
- Browser verification has been done by the user before commit. `npm run lint && npm run test && npm run build` all pass.

## Closing the epic

When A, B, and C are merged:

1. Verify the success criteria in the PRD by exercising the three new tools in a single session (read notes → fetch a URL → list modules → write notes).
2. Move `docs/docs-context/` to `docs/archive/docs-context/`. Per CLAUDE.md, archived docs are not rewritten.
3. Close epic #141.

Phase 2 work (`get_board_quickref`, `get_module_docs`, `search_documentation`, doc-fetcher utility with caching) is captured in SPEC §8. If picked up later, it gets a new feature subdirectory and its own epic — phase 1 establishes the tool surface phase 2 builds on without forcing a coupling.
