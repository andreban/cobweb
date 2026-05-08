# Tool Approval — Product Requirements Document

## Problem Statement

The Cobweb agent currently writes to the user's editor and to the connected device's filesystem without asking. `WriteEditorTool` replaces the entire buffer in one call; `WriteDeviceFileTool`, `DeleteDeviceFileTool`, and `MakeDeviceDirTool` perform their device-side mutation immediately. Each tool's `requiresApproval: true` flag in `ToolDefinition` is purely declarative — nothing in the runtime gates the call.

For a coding assistant the user trusts to touch their working buffer, this is the wrong default. Users want to see *what* the model is about to change *before* it lands, especially when the model is iterating on existing code or rewriting a `main.py` that controls real hardware. Other agentic editors (`agent-text-editor`, Claude Code's own Edit tool) solve this by suspending the tool call until the user clicks Accept or Reject, with a focused diff for partial edits.

This feature introduces that approval gate to Cobweb. As a prerequisite, it also introduces the kind of tool that *deserves* a diff: partial-edit `edit_editor` / `edit_device_file` tools modelled on Claude Code's Edit tool (uniqueness-based find/replace), and batched `multi_edit_editor` / `multi_edit_device_file` tools modelled on Claude Code's MultiEdit (an array of sequential edits applied atomically). Whole-buffer `write_editor` / `write_device_file` continue to exist for new files and full rewrites, but get a confirmation card rather than a diff.

## Target Users

Same as the parent PRD (educators, hobbyists, beginners). Two scenarios this feature unlocks:

- **Hobbyist** asks the agent to "tweak the LED blink rate" mid-iteration. The agent calls `edit_editor` with a small `old_string` / `new_string`. The user sees only the changed lines highlighted, accepts, and the buffer updates.
- **Hobbyist** asks the agent to "rename the `tick` function to `step` everywhere and add a docstring." The agent calls `multi_edit_editor` with several `{ old_string, new_string }` edits in one call. The user sees one card with multiple diff hunks, accepts once, and all edits apply atomically.
- **Educator** asks the agent to "save the lesson plan as `main.py` on the board." The agent calls `write_device_file`. The user sees a confirmation card showing the target path and a preview of the new file, accepts, and the file is written.

## Goals

1. **Diff approval for partial edits.** Introduce `edit_editor` and `edit_device_file` tools that take `old_string` / `new_string`, verify uniqueness, and surface a focused diff in the chat panel. Accepting applies the edit; rejecting tells the model the edit was declined. Introduce `multi_edit_editor` and `multi_edit_device_file` for batched edits — an array of `{ old_string, new_string }` applied sequentially and atomically (all-or-nothing). The diff card shows every changed region as a stacked hunk so the user reviews the cumulative result with one decision.
2. **Confirmation approval for non-edit writes.** `write_editor`, `write_device_file`, `delete_device_file`, and `make_device_dir` show a confirmation card describing what will change. Approving runs the operation; rejecting tells the model.
3. **Inline UI.** Approval cards render inside the conversation panel inline with the message stream, not as a separate modal — so the diff stays in the conversation context.
4. **Suspend-and-resume tool model.** A tool's `call()` returns a Promise that only resolves once the user decides. The mast-ai agent loop blocks naturally; no special framework support is required.
5. **Cancellation safety.** When the user resets the conversation or cancels a run, any pending approval resolves as `'rejected'` so the suspended tool unblocks before the agent run is torn down.

## Out of Scope

- **Approve-all / always-allow toggle.** A "trust this tool for this session" affordance is appealing but adds preference state and an opt-out path that we'd rather defer until we have feedback on the explicit-approval flow.
- **Cross-call batching.** Each tool call gets its own approval card. We do not group multiple separate tool calls into a single summary — `multi_edit_*` covers the "several edits at once" need within one call.
- **`replace_all` semantics.** Claude Code's MultiEdit lets each edit set `replace_all: true` to substitute every occurrence. v1 tools require uniqueness for every `old_string`; if real use cases call for bulk replace, we add it later.
- **Edit-the-edit.** The user can Accept or Reject. They cannot tweak `new_string` before accepting. If they want a different edit, they Reject and ask the model again.
- **Stale-read protection.** If the user edits the buffer between the model reading and the model proposing an edit, we still apply find/replace against the *current* buffer. Uniqueness of `old_string` is the only guard. (Same model as Claude Code's Edit tool.)
- **Approval for read-only tools.** `read_editor`, `run_editor`, `run_snippet`, `read_repl_history`, `list_device_files`, `read_device_file` continue to run without approval. `run_editor` and `run_snippet` execute code on hardware but are part of the user's expected REPL loop; gating them would create constant approval prompts.
- **Persistence of declined edits.** Rejected edits leave no trace in the conversation transcript beyond the model's tool result; we do not maintain a "rejected suggestions" history.

## Success Criteria

- A user asks the agent to make a small change to an existing program. The agent calls `edit_editor`. The conversation panel renders a card showing the changed region with red strikethrough + green highlight on the modified words, plus 2 lines of unchanged context above and below. Accept applies the edit to the buffer.
- A user asks the agent to make several related changes in one go (e.g. rename a function and update its callers). The agent calls `multi_edit_editor` with an array of edits. The card shows one hunk per non-adjacent changed region, all from the same proposed final buffer. Accept applies every edit atomically; if any one of them fails uniqueness, the card shows which edit (by index) failed and what went wrong, Approve is disabled, and Reject sends a structured error back to the model.
- A user asks the agent to write a new `main.py`. The agent calls `write_editor` with the full new code. The conversation panel renders a confirmation card showing the new content (scrollable preview). Accept replaces the buffer.
- A user asks the agent to save the current buffer to `/main.py` on the device. The agent calls `write_device_file`. The card shows path + content preview. Accept writes the file.
- A user asks the agent to delete `/old.py` on the device. The card shows the path with a destructive-action style. Accept deletes; reject tells the model "user declined."
- During an in-flight tool approval, clicking "New conversation" cancels cleanly: the pending card disappears, the agent run is reset, and no orphaned promise is left blocking a future tool call.
- A rejected edit never mutates the editor or the device.
- The diff for a single-word change shows exactly the changed line + 2 lines context above + 2 lines context below — not the whole buffer.
