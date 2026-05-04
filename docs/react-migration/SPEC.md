# React Migration — Technical Specification

## Editor: CodeMirror 6 vs Monaco

| Criterion | CodeMirror 6 (latest stable) | Monaco |
|-----------|------------------------------|--------|
| Bundle size | ~200 KB gzipped | ~1.5 MB gzipped |
| Python support | `@codemirror/lang-python` | built-in |
| LSP / IntelliSense | plugin-based | built-in (not useful for MicroPython) |
| AI completion integration | extension API | markers + completion provider API |
| Mobile | yes | limited |
| React integration | manual (`useEffect`) | `@monaco-editor/react` wrapper |
| Current usage | 0.18.x (pre-stable, needs upgrade) | not in project |

**Decision: CodeMirror 6 (latest stable).**

MicroPython has no language server, so Monaco's primary advantage (IntelliSense) does not apply. The ~7× bundle size difference is meaningful for a web app. CodeMirror's extension API is well-suited for surfacing AI suggestions as a completion source. The upgrade from 0.18.x → 6.x stable is necessary regardless; now is the right time.

New packages: `codemirror`, `@codemirror/lang-python`, `@codemirror/theme-one-dark`.
Remove: `@codemirror/basic-setup@0.18.x`, `@codemirror/lang-python@0.18.x`, `@codemirror/text@0.18.x`, `@codemirror/view@0.18.x`.

---

## MVVM Architecture

```
┌─────────────────────────────────────────────────────┐
│  Models (plain TS, no React)                        │
│  ReplInterface · AgentRunner · ToolRegistry         │
└──────────────────────┬──────────────────────────────┘
                       │ owned by
┌──────────────────────▼──────────────────────────────┐
│  ViewModels (custom hooks)                          │
│  useReplConnection · useEditor · useProviderConfig  │
└──────────────────────┬──────────────────────────────┘
                       │ props + callbacks
┌──────────────────────▼──────────────────────────────┐
│  Views (React components, no Model imports)         │
│  App · Toolbar · SplitPane · CodeEditor             │
│  ReplShell · FileNavigator · StatusBar              │
│  SettingsPanel                                      │
│  AgentProvider + ConversationPanel (@mast-ai/react-ui) │
└─────────────────────────────────────────────────────┘
```

Models are created once (in `src/models.ts`) and passed into hooks. Hooks translate model state and events into React state and callbacks. Components receive only primitives, callbacks, and refs — they never import a Model class.

---

## Provider Abstraction (`src/providers/`)

The abstraction point for LLM providers is mast-ai's `LlmAdapter` interface. A `ProviderConfig` discriminated union captures user-supplied settings; a factory function maps it to an adapter. Adding a new provider means adding a new discriminant and a factory case — no other code changes.

### `ProviderConfig` type (`src/providers/types.ts`)

```ts
export type ProviderConfig =
  | { provider: 'google-genai'; apiKey: string; model?: string }
  | { provider: 'urp'; endpoint: string };
  // Future: | { provider: 'built-in-ai' }
  //         | { provider: 'openai'; apiKey: string; model?: string }
```

### Factory (`src/providers/factory.ts`)

```ts
export function createAdapter(config: ProviderConfig): LlmAdapter {
  switch (config.provider) {
    case 'google-genai':
      return new GoogleGenAIAdapter(config.apiKey, config.model);
    case 'urp':
      return new UrpAdapter(new HttpTransport(config.endpoint));
  }
}
```

### Persistence (`src/providers/storage.ts`)

`ProviderConfig` is persisted to `localStorage` under the key `cobweb:provider-config`. No additional encryption — the user acknowledges the API key is stored in browser storage. Exported helpers: `loadProviderConfig(): ProviderConfig | null`, `saveProviderConfig(config: ProviderConfig): void`, `clearProviderConfig(): void`.

### `useProviderConfig` hook

```ts
{
  config: ProviderConfig | null,
  save(config: ProviderConfig): void,
  clear(): void,
}
```

Reads from `localStorage` on mount; exposes `save` and `clear`. Does **not** own the `AgentRunner` — the runner is derived in `<App>` with `useMemo` so React manages the rebuild automatically when `config` changes:

```tsx
// In <App>:
const { config, save, clear } = useProviderConfig();

const runner = useMemo(() => {
  if (!config) return null;
  const adapter = createAdapter(config);
  return new AgentRunner(adapter, models.tools);
}, [config, models.tools]);
```

`AgentProvider runner={runner}` receives `null` when config is absent — `<ChatInput>` greys out automatically and `useAgent().isReady` is `false`.

---

## Models (`src/models.ts`)

Instantiated once at app startup:

```ts
export interface AppModels {
  tools: ToolRegistry;
}

export function createModels(): AppModels {
  return {
    tools: new ToolRegistry(),
  };
}
```

`repl` is not in `AppModels` — `ReplInterface` can only be constructed after the user picks a serial port, so `useReplConnection` owns its lifecycle entirely (calling `ReplInterface.connect()` internally).

`AgentRunner` is not in `AppModels` — it is owned by `useProviderConfig` and recreated when the provider config changes.

---

## Agent Tools (`src/agent/tools/`)

Registered into the shared `ToolRegistry` from `AppModels` at startup, before any adapter is created. Tool implementations receive stable callbacks (not Model references) injected via `wireTools(tools, bindings)` in `App` after the hooks are ready.

```ts
// src/agent/wireTools.ts
export interface ToolBindings {
  getEditorContent(): string;
  setEditorContent(code: string): void;
  runCode(code: string): Promise<{stdout: string; stderr: string}>;
  getReplHistory(): string[];
  onData(handler: (data: Uint8Array) => void): () => void;
}

export function wireTools(tools: ToolRegistry, bindings: ToolBindings): void;
```

`wireTools` registers each tool exactly once per `ToolRegistry` instance and updates the bindings on subsequent calls, so `<App>` can re-invoke it from a `useEffect` whose deps include `replHistory` (which changes on every output line) without re-registering the tools.

### `ReadEditorTool`
- scope: `'read'`
- Returns the current editor content as a string.

### `WriteEditorTool`
- scope: `'write'`, `requiresApproval: false`
- Args: `{ code: string }`
- Calls `bindings.setEditorContent(code)`.

### `RunCodeTool`
- scope: `'write'`, `requiresApproval: true`
- Args: `{ code?: string }` — if omitted, runs the current editor content.
- Sends code to the REPL via `bindings.runCode`, which now parses the raw-REPL response and resolves with `{stdout, stderr}`. The tool formats those into a single string for the agent (labels stderr when present), instead of relying on idle/max output timers.

### `ReadReplHistoryTool`
- scope: `'read'`
- Args: `{ lines?: number }` — defaults to 20.
- Returns the last N lines of `bindings.getReplHistory()`, joined by newlines.

### Agent Config (`src/agent/config.ts`)

Use `createAgent()` from `@mast-ai/core` (not a plain object):

```ts
import { createAgent } from '@mast-ai/core';

export const CODING_AGENT = createAgent({
  name: 'cobweb-assistant',
  instructions: `You are a MicroPython coding assistant for the Cobweb IDE.
You have access to the user's code editor and a live MicroPython REPL connected to a microcontroller.
Help the user write, debug, and understand MicroPython code.
When asked to write code, use write_editor then offer to run it.
When running code, use run_code and report the output to the user.`,
  tools: ['read_editor', 'write_editor', 'run_code', 'read_repl_history'],
});
```

---

## mast-ai React UI Integration

Use `@mast-ai/react-ui` for the agent chat panel. No custom chat UI is needed.

Import the stylesheet once in `src/main.tsx`:
```ts
import '@mast-ai/react-ui/styles.css';
```

```tsx
// In <App>:
<AgentProvider
  runner={runner}
  agent={CODING_AGENT}
  onApprovalRequired={async (call) => call.name === 'run_code' ? INLINE_APPROVAL : true}
  onConversationChange={(history, entries) => {
    localStorage.setItem('cobweb:conversation', JSON.stringify({ history, entries }));
  }}
  initialHistory={savedConversation?.history}
  initialEntries={savedConversation?.entries}
>
  <ConversationPanel inputPlaceholder="Ask the assistant…" />
</AgentProvider>
```

- `runner` comes from `useMemo` in `<App>`. When `null`, `AgentProvider` renders with `ChatInput` disabled — the user sees the panel but cannot send messages.
- `RunCodeTool` uses `INLINE_APPROVAL` so the user confirms before code runs on the device. Other tools (read/write editor) execute silently.
- `onConversationChange` persists conversation history to `localStorage` after each completed turn, so the conversation survives page reloads.
- `useAgent().isReady` can be read by `<Toolbar>` to show a "configure agent" prompt when no provider is set.

---

## Settings Panel (`<SettingsPanel>`)

A modal or slide-over that lets the user:
1. Select a provider from a dropdown (initially only "Google Gemini").
2. Enter the required fields for that provider (API key, and optionally model name).
3. Save (calls `useProviderConfig.save`) or clear (calls `useProviderConfig.clear`) the config.

Props: `isOpen: boolean`, `onClose: () => void`, `config: ProviderConfig | null`, `onSave: (config: ProviderConfig) => void`, `onClear: () => void`.

No Model or hook imports. A "Settings" button in `<Toolbar>` opens it.

---

## Component Tree

```
<App>                              — holds AppModels in ref; calls hooks; wires tools
├── <AgentProvider runner={...}>   — from @mast-ai/react-ui; runner null when unconfigured
│   ├── <Toolbar>                  — connect/disconnect/reset/run + settings button
│   ├── <SplitPane horizontal>     — FileNavigator | main area
│   │   ├── <FileNavigator>        — collapsible left panel
│   │   └── <SplitPane horizontal> — editor+repl | agent
│   │       ├── <SplitPane vertical> — editor | repl
│   │       │   ├── <CodeEditor>
│   │       │   └── <ReplShell>
│   │       └── <ConversationPanel> — from @mast-ai/react-ui
│   ├── <StatusBar>
│   └── <SettingsPanel>            — modal, controlled by isSettingsOpen state
```

---

## ViewModels (hooks)

### `useReplConnection()`

Owns the `ReplInterface` lifecycle. `connect()` calls `ReplInterface.connect()` to acquire a serial port and create the instance; `disconnect()` tears it down.

```ts
{
  connectionState: 'disconnected' | 'connected',
  connect(): Promise<void>,
  disconnect(): Promise<void>,
  reset(): Promise<void>,
  runCode(code: string): Promise<{stdout: string; stderr: string}>,
  replHistory: string[],            // last N lines, for ReadReplHistoryTool
  onData(handler: (data: Uint8Array) => void): () => void,
}
```

### `useEditor()`

```ts
{
  editorRef: RefObject<HTMLDivElement>,
  getContent(): string,
  setContent(code: string): void,
}
```

Creates the CodeMirror `EditorView` in a `useEffect` attached to `editorRef`. Stable callbacks via `useCallback` + internal view ref.

### `useProviderConfig()`

See Provider Abstraction section above.

### `useTheme()`

```ts
{
  theme: 'light' | 'dark',
  toggle(): void,
}
```

On mount, reads `localStorage` key `cobweb:theme`. If absent, reads `window.matchMedia('(prefers-color-scheme: dark)')`. Applies/removes the `dark` class on `<html>` whenever `theme` changes. `toggle()` flips the value and persists it to `localStorage`.

Used by `<Toolbar>` to render a sun/moon icon button. No other component needs to import it — `<html class="dark">` is all shadcn/ui requires.

### Agent state — `useAgent()` from `@mast-ai/react-ui`

Agent streaming state is **not** a custom hook — it is provided by `useAgent()` from `@mast-ai/react-ui`, available to any component inside `<AgentProvider>`. No `useAgent` hook is implemented in this project.

---

## Component Specifications

### `<CodeEditor>`

Props: `editorRef: RefObject<HTMLDivElement>`.
Renders a single `<div ref={editorRef}>`. CodeMirror is mounted by `useEditor` — the component itself contains no CodeMirror code.

### `<ReplShell>`

Props: `onData: (handler: (data: Uint8Array) => void) => () => void`.
Creates xterm `Terminal` + `FitAddon` in `useEffect`. Subscribes via `onData`; cleans up on unmount. `ResizeObserver` calls `fitAddon.fit()`.

### `<FileNavigator>`

Props: `onFileSelected: (content: string) => void`.
Calls `window.showOpenFilePicker()` on click. No Model imports.

### `<SplitPane>`

Props: `orientation: 'horizontal' | 'vertical'`, `initialSize: number` (% for first pane), `children: [ReactNode, ReactNode]`.
Divider position in `useState`; pointer events on the divider handle dragging.

The three-column layout (FileNavigator | editor+repl | agent) is achieved by nesting two horizontal `<SplitPane>` instances. Collapsibility of `<FileNavigator>` is a separate concern handled by `<FileNavigator>` itself, not by `<SplitPane>`.

### `<Toolbar>`

Props: `connectionState`, `onConnect`, `onDisconnect`, `onReset`, `onRun`, `onOpenSettings`, `isAgentConfigured: boolean`, `theme: 'light' | 'dark'`, `onToggleTheme: () => void`.

### `<StatusBar>`

Props: `connectionState`, `isAgentConfigured: boolean`, `leftOpen: boolean`, `replOpen: boolean`, `rightOpen: boolean`, `onToggleLeft: () => void`, `onToggleRepl: () => void`, `onToggleRight: () => void`.

Panel toggle buttons (PanelLeft / PanelBottom / PanelRight icons from lucide-react) sit in the bottom-right of the bar, matching the Zed IDE convention. Active panels use `text-foreground`; collapsed panels use `text-muted-foreground`. Panel open/closed state lives in `<App>` and is passed down as props.

---

## UI Component Library

**Decision: shadcn/ui + Tailwind CSS v4.**

The app needs modest UI primitives (buttons, modal dialog, dropdown, text inputs) for the toolbar and settings panel. shadcn/ui provides copy-paste components built on Radix UI (accessible) with zero runtime library overhead — components live in `src/components/ui/` and are fully owned by the project. Tailwind CSS v4 (via `@tailwindcss/vite`) handles styling with no separate config file.

daisyUI was considered but offers less flexibility for a custom IDE layout. MUI was ruled out as too heavyweight and opinionated.

**Packages added:** `tailwindcss`, `@tailwindcss/vite`, `tw-animate-css`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@radix-ui/*` (installed on demand by shadcn CLI).

---

## New Dependencies

| Package | Purpose |
|---------|---------|
| `react@^19`, `react-dom@^19` | React runtime (19+ required by `@mast-ai/react-ui`) |
| `@types/react`, `@types/react-dom` | TypeScript types |
| `@vitejs/plugin-react` | Vite JSX transform |
| `@tanstack/react-virtual` | Required peer dep of `@mast-ai/react-ui` (`<MessageList>` uses virtual scrolling) |
| `codemirror` | CodeMirror 6 stable |
| `@codemirror/lang-python` | Python language support |
| `@codemirror/theme-one-dark` | Editor theme |
| `@mast-ai/core` | AgentRunner, ToolRegistry, createAgent, types |
| `@mast-ai/google-genai` | GoogleGenAIAdapter |
| `@mast-ai/react-ui` | AgentProvider, ConversationPanel, useAgent, hooks |
| `@google/genai` | Gemini SDK (peer dep of google-genai adapter) |
| `react-markdown`, `remark-gfm`, `rehype-sanitize` | Optional — enables Markdown rendering in assistant bubbles |
| `tailwindcss`, `@tailwindcss/vite` | Tailwind CSS v4 (styling for shadcn/ui components) |
| `tw-animate-css` | Animation utilities used by shadcn/ui |
| `class-variance-authority`, `clsx`, `tailwind-merge` | shadcn/ui component utilities |
| `lucide-react` | Icon set used by shadcn/ui |

**Remove:** `lit`, `@codemirror/basic-setup@0.18.x`, `@codemirror/lang-python@0.18.x`, `@codemirror/text`, `@codemirror/view@0.18.x`

---

## Vite Config

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
});
```

## TypeScript Config

Remove `experimentalDecorators` (was required for Lit). Add JSX:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "strict": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

---

## `index.html`

Replace the current `<body>` content with a single mount point:

```html
<body>
  <div id="root"></div>
</body>
<script type="module" src="/src/main.tsx"></script>
```

---

## File Map

**Delete:**
- `src/components/SplitPane.ts`
- `src/components/ReplShell.ts`
- `src/components/FileNavigator.ts`
- `src/CodeEditor.ts`
- `src/main.ts`

**Add:**
- `src/main.tsx`
- `src/models.ts`
- `src/App.tsx`
- `src/providers/types.ts`
- `src/providers/factory.ts`
- `src/providers/storage.ts`
- `src/hooks/useReplConnection.ts`
- `src/hooks/useEditor.ts`
- `src/hooks/useProviderConfig.ts`
- `src/hooks/useTheme.ts`
- `src/agent/tools/ReadEditorTool.ts`
- `src/agent/tools/WriteEditorTool.ts`
- `src/agent/tools/RunCodeTool.ts`
- `src/agent/tools/ReadReplHistoryTool.ts`
- `src/agent/config.ts` — `CODING_AGENT` config constant
- `src/components/Toolbar.tsx`
- `src/components/SplitPane.tsx`
- `src/components/CodeEditor.tsx`
- `src/components/ReplShell.tsx`
- `src/components/FileNavigator.tsx`
- `src/components/StatusBar.tsx`
- `src/components/SettingsPanel.tsx`

**Keep unchanged:**
- `src/ReplInterface.ts`
- `src/Queues.ts`

---

## Resources

### mast-ai
- [Repository](https://github.com/andreban/mast-ai)
- [`@mast-ai/react-ui` usage guide](https://github.com/andreban/mast-ai/blob/main/docs/react-ui/USAGE.md)
- [`@mast-ai/react-ui` SPEC](https://github.com/andreban/mast-ai/blob/main/docs/react-ui/SPEC.md)
- [`@mast-ai/core` source](https://github.com/andreban/mast-ai/tree/main/packages/core/src)
- [`@mast-ai/google-genai` source](https://github.com/andreban/mast-ai/tree/main/packages/google-genai/src)

### React
- [React 19 docs](https://react.dev)
- [`@tanstack/react-virtual`](https://tanstack.com/virtual/latest)

### CodeMirror 6
- [CodeMirror docs](https://codemirror.net/docs/)
- [`@codemirror/lang-python`](https://github.com/codemirror/lang-python)

### xterm.js
- [xterm.js docs](https://xtermjs.org/docs/)

### Vite
- [Vite docs](https://vite.dev/guide/)
- [`@vitejs/plugin-react`](https://github.com/vitejs/vite-plugin-react)
