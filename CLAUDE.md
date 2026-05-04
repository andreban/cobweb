# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About

Cobweb is a browser-based MicroPython IDE. It runs entirely client-side, connecting to microcontrollers (e.g., Raspberry Pi Pico) via the Web Serial API. There is no backend.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Production build (output to dist/)
npm run preview      # Preview production build locally
```

There are no test or lint scripts.

## Architecture

**Entry point:** `src/main.ts` — wires together all components and manages the connect/disconnect/reset lifecycle.

**Core modules:**

- `src/ReplInterface.ts` — wraps the Web Serial API (115200 baud, 8N1) and implements the MicroPython REPL protocol (Ctrl-A raw mode, Ctrl-D soft reset, etc.). Extends `EventTarget` to emit `'data'` events for incoming bytes.
- `src/CodeEditor.ts` — wraps CodeMirror 6 with Python language support.
- `src/Queues.ts` — generic `Queue<T>` and `AsyncBlockingQueue<T>` used for serial read/write coordination.

**Lit web components** (in `src/components/`):

- `SplitPane` — draggable splitter supporting horizontal/vertical layouts with mouse and touch.
- `ReplShell` — terminal emulator wrapping xterm.js, renders microcontroller output.
- `FileNavigator` — file browser using the File System Access API.

**Data flow:**
```
CodeEditor → Run → ReplInterface.sendRaw() → Web Serial → microcontroller
microcontroller → ReplInterface ('data' event) → ReplShell (xterm.js)
```

**UI layout** (`index.html`): three-pane split — FileNavigator (left) | CodeEditor (top-right) | ReplShell (bottom-right), composed with nested `<split-pane>` elements.

Static assets (`manifest.json`, `images/`, `sw.js`, `404.html`) live in `public/` — Vite copies them to `dist/` on build.

## Docs

- `docs/PRD.md` — problem statement, target users, goals, success criteria
- `docs/SPEC.md` — component interfaces, browser API requirements, build pipeline

`docs/PRD.md` and `docs/SPEC.md` are project-level and live in the `docs/` root. Sub-feature docs go in a subdirectory under `docs/` with their own `PRD.md` and `SPEC.md`. When a feature is complete, move its subdirectory to `docs/archive/`. Do not rewrite or restructure files in `docs/archive/`.

Before starting work on a feature, check its subdirectory in `docs/` for context. When creating docs for a new feature, create a subdirectory under `docs/` and write a `PRD.md` and `SPEC.md` there.

**All PRD.md, SPEC.md, and README.md must be kept up to date throughout implementation.** Any change to requirements, technical decisions, or architecture must be reflected in the relevant doc before or alongside the code change. All files must be current before opening a pull request.

## GitHub Issues

- Each feature has a GitHub label matching its `docs/` subdirectory name (e.g. `repl-improvements`).
- All issues belonging to a feature must carry that label. Create the label first if it doesn't exist.
- To see all issues for a feature: `gh issue list --label <feature-name>`.
- Issues must contain enough information to implement the task without needing to ask for clarification: relevant context, constraints, acceptance criteria, and any non-obvious decisions.
- Reference the PRD and SPEC by file path and section rather than repeating their content. Reference related issues by number where dependencies or shared context exist.
- Explicitly state dependencies with "Depends on #N" so the implementation order is clear. Before starting work on an issue, check that all its dependencies are merged.
- Implementation details (key decisions, non-obvious choices, patterns introduced) belong in the PR description, not in issue comments. When starting work on an issue with dependencies, read the PRs that closed those issues for implementation context.
- Always include `Closes #N` in the PR description so GitHub auto-closes the issue on merge.

### Native GitHub Relationships (required for every new issue)

After creating an issue, always set its native GitHub relationships via the GraphQL API. Text-only "Depends on #N" in the body is not enough.

**Step 1 — Get node IDs** for all issues involved:
```bash
gh api graphql -f query='{
  repository(owner: "andreban", name: "cobweb") {
    a: issue(number: PARENT) { id }
    b: issue(number: NEW_ISSUE) { id }
    c: issue(number: BLOCKER) { id }
  }
}'
```

**Step 2 — Set parent** (new issue is a sub-issue of the epic):
```bash
gh api graphql -f query='mutation {
  addSubIssue(input: { issueId: "PARENT_NODE_ID", subIssueId: "NEW_ISSUE_NODE_ID" }) {
    issue { number }
  }
}'
```

**Step 3 — Set blocked-by** (repeat for each blocker):
```bash
gh api graphql -f query='mutation {
  addBlockedBy(input: { issueId: "NEW_ISSUE_NODE_ID", blockingIssueId: "BLOCKER_NODE_ID" }) {
    issue { number }
  }
}'
```

**To verify** relationships are set:
```bash
gh api graphql -f query='{
  repository(owner: "andreban", name: "cobweb") {
    issue(number: N) {
      parent { number }
      blockedBy(first: 10) { nodes { number } }
      blocking(first: 10) { nodes { number } }
    }
  }
}'
```

## Git Conventions

- Always use `Edit` to modify existing files — never rewrite them wholesale with `Write`. Small diffs make reviews easier.
- Always run `npm run build` before committing and fix any failures.
- Always ask the user to manually test in the browser before committing. Never commit or open a pull request until the user has confirmed the test passed.
- **Branch strategy:**
  1. Before starting work on an issue, check out `main` and pull the latest (`git checkout main && git pull`).
  2. Create a branch off `main` for the issue's work, namespacing by feature (e.g. `git checkout -b feat/repl-improvements/auto-reconnect`).
  3. Open the PR against `main` (`gh pr create --base main`).
