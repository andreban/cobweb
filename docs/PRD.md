# Cobweb — Product Requirements Document

## Problem Statement

MicroPython development typically requires installing desktop tools (Thonny, VS Code extensions, ampy, etc.) and managing drivers for serial communication. This friction raises the barrier for educators, hobbyists, and beginners who want to program microcontrollers.

Cobweb removes that friction by running the entire development workflow in the browser. No installation, no drivers beyond what the OS provides — just open a URL and connect a board.

## Target Users

- Educators running workshops or classroom sessions with Raspberry Pi Pico or similar boards.
- Hobbyists who want a lightweight, always-available IDE without managing a local toolchain.
- Beginners encountering MicroPython for the first time.

## Goals

- Provide a Python code editor with syntax highlighting in the browser.
- Connect to a MicroPython REPL over Web Serial (no extensions, no native app).
- Execute code on the connected device and display output in an integrated terminal.
- Allow browsing and opening files from the local filesystem to load into the editor.
- Allow browsing, editing, and managing files on the connected microcontroller's filesystem (see `docs/device-files/`).
- Work as a Progressive Web App (installable, offline-capable UI shell).

## Out of Scope

- Debugging (breakpoints, step-through).
- Multi-file project management or a build pipeline.
- Any server-side component.

## Success Criteria

- A user with a Pico connected via USB can write code, click Run, and see output in the terminal within 60 seconds of opening the app — with no prior setup.
- The app works in any Chromium-based browser that supports the Web Serial API.
- The UI is usable on a laptop screen without horizontal scrolling.
