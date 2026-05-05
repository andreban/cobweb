<img src="./public/logo.svg" alt="" width="80" align="right">

# Cobweb

A browser-based MicroPython IDE. Plug in a microcontroller, open the page, write code — no installs, no drivers, no extensions.

## Features

- **Python editor** with syntax highlighting (CodeMirror 6).
- **Live REPL** over the Web Serial API at 115200 baud, with raw-paste mode for fast uploads of larger programs.
- **Run on device** — execute the editor's contents on the connected board and watch output stream into the integrated terminal.
- **Local file access** — open `.py` files from your computer via the File System Access API; the last folder you opened is restored on reload.
- **Device filesystem browser** — list, read, write, and delete files on the microcontroller; create directories.
- **AI coding assistant** (optional) — a built-in chat panel that can read and write the editor, run snippets, and inspect the device filesystem. Powered by Google Gemini; bring your own API key.
- **Progressive Web App** — installable on desktop and mobile.
- **Light / dark themes**, toggled from the toolbar.

## Requirements

- A Chromium-based browser (Chrome, Edge, Brave, Opera, Arc). The [Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) and [File System Access](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) APIs aren't available in Firefox or Safari.
- A microcontroller running MicroPython. Raspberry Pi Pico is the primary target, but any MicroPython device that exposes a USB serial REPL should work.

## Running locally

```bash
git clone https://github.com/andreban/cobweb
cd cobweb
npm install
npm run dev          # http://localhost:5173
```

Production build:

```bash
npm run build        # output in dist/
npm run preview      # preview the production build
```

## Using the AI assistant

The AI panel is opt-in. To enable it:

1. Open **Settings** in the toolbar.
2. Paste a [Google AI Studio API key](https://aistudio.google.com/app/apikey) and pick a Gemini model.
3. Save. The key is stored locally in your browser only — no server is involved.

## Development

```bash
npm run lint         # ESLint
npm run format       # Prettier (auto-fix in src/)
npm run test         # Vitest (single run)
npm run test:watch   # Vitest (watch mode)
```

Built with React 19, Vite 8, TailwindCSS 4, CodeMirror 6, and xterm.js. Tests run on `happy-dom` via Vitest.

Architecture details and contribution conventions live in [`CLAUDE.md`](./CLAUDE.md), [`docs/PRD.md`](./docs/PRD.md), and [`docs/SPEC.md`](./docs/SPEC.md). Per-feature design docs live in `docs/<feature>/` and are moved to `docs/archive/<feature>/` once shipped.

## License

[Apache-2.0](./LICENSE).
