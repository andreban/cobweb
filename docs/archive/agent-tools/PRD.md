# Agent Tools — Product Requirements Document

## Problem Statement

The Cobweb coding assistant has a capable set of tools for reading and modifying the editor and device filesystem, but several gaps limit its effectiveness in iterative debugging workflows.

- **No way to stop a running program.** `run_editor` returns immediately; the agent (and the user) must manually send Ctrl+C to stop an event loop or runaway process.
- **No board awareness at session start.** The agent learns nothing about the connected board unless it probes it first, burning tool calls and context on boilerplate questions (firmware version, platform, available RAM).
- **Verbose two-step workflows.** Opening a device file in the editor requires `read_device_file` + `write_editor` (two calls, two approvals). Saving the editor buffer to a device path requires `read_editor` + `write_device_file`. These are common enough to deserve atomic, legibly named tools.
- **Unstructured exception output.** `run_snippet` returns raw REPL text. When MicroPython throws an exception the agent must parse the traceback itself; errors in that parsing compound the debugging loop.

## Target Users

Same as the parent PRD (educators, hobbyists, beginners). Scenarios this feature unlocks:

- **Hobbyist** asks the agent to run a blink loop for testing, then asks it to stop. The agent calls `stop_program` without waiting for the user to press Ctrl+C.
- **Educator** asks the agent to "open `sensor.py` from the device and tweak the threshold." The agent calls `open_device_file_in_editor("/sensor.py")` in one approval step rather than two.
- **Beginner** asks "what board am I on?" The agent already knows from its system prompt — no probe tool call needed.

## Goals

1. **Stop control.** Add a `stop_program` tool (sends Ctrl+C to the REPL) and a matching Stop button in the toolbar so both the agent and the user can interrupt a running program.
2. **Board context injection.** Run a one-shot probe on connect (`sys.implementation`, `sys.platform`, `gc.mem_free()`) and inject the result into the agent's system prompt so the model's first response is already board-aware.
3. **Convenience tools.** Add `open_device_file_in_editor` (atomic device read + editor write) and `save_editor_to_device` (atomic editor read + device write) to eliminate two-step round-trips for common workflows.
4. **Structured exception output.** Detect MicroPython tracebacks in `run_snippet` stderr and return structured data (`exception.type`, `exception.message`, `exception.line`) so the agent can act on the error without parsing free text.

## Out of Scope

- Multi-agent architecture (separate epic).
- MicroPython documentation and board-specific context injection beyond the live probe (separate `docs-context` epic).

## Success Criteria

- Agent can interrupt a running program without user intervention via `stop_program`; user can do the same via the toolbar Stop button.
- Agent's first message after connecting reflects the board identity (firmware name + version, platform, free RAM) without a probe tool call.
- Agent can open a device file in the editor in one tool call (`open_device_file_in_editor`), with a single approval step showing the file content.
- Agent can save the editor buffer to a device path in one tool call (`save_editor_to_device`), with a single approval step showing the content.
- When a `run_snippet` call raises a MicroPython exception, the tool result includes a structured `exception` object; the agent can extract the type, message, and line number without parsing raw text.
