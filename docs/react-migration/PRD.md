# React Migration — Product Requirements Document

## Problem Statement

The current UI layer uses Lit web components. Lit is well-suited for standalone custom elements but has a smaller ecosystem, less tooling support, and fewer contributors familiar with it compared to React. Migrating to React brings the project in line with the dominant frontend ecosystem, making it easier to onboard contributors, leverage community libraries, and maintain the codebase long-term.

This migration is also the right moment to introduce an AI coding assistant and establish a clean MVVM architecture, since all UI code is being rewritten anyway.

## Goals

1. **React UI** — Replace all Lit web components with React components offering identical layout and behaviour: split-pane, code editor, REPL terminal, file navigator, connection toolbar.
2. **MVVM architecture** — Enforce separation between Models (serial/agent logic), ViewModels (React hooks), and Views (presentational components). No component reaches directly into a Model.
3. **AI coding assistant** — Integrate a mast-ai `AgentRunner` that can read and write the editor, run code in the REPL, and converse with the user in a dedicated chat panel backed by `@mast-ai/react-ui`.
4. **Configurable provider** — The user supplies an API key and selects a provider (initially Google Gemini) via a settings UI. The architecture must make adding future providers straightforward without further restructuring.
5. **Editor upgrade** — Replace the current pre-stable `@codemirror/*@0.18.x` packages with a modern editor (see SPEC for decision).

## Out of Scope

- Changes to `ReplInterface.ts` or `Queues.ts`.
- New REPL features (file management on device, debugging, breakpoints).
- Multi-file project management.
- Server-side components.
- Providers beyond Google Gemini in this iteration (the architecture must support them, but implementing additional adapters is deferred).

## Success Criteria

- The app behaves identically to the current version for all existing workflows.
- A settings panel lets the user select a provider and enter an API key, persisted to `localStorage`.
- An AI chat panel is present; when configured, the user can describe a task and the agent writes code into the editor and optionally runs it.
- When no provider is configured the chat panel is disabled but visible, and prompts the user to open settings.
- No Lit dependency remains in `package.json`.
- All React components are purely presentational — no component imports `ReplInterface` or `AgentRunner` directly.
