// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry, type ToolBindings } from '@mast-ai/core';
import { WebMcpBridge } from './WebMcpBridge';
import { ReadEditorTool } from '../agent/tools/ReadEditorTool';
import { EditEditorTool } from '../agent/tools/EditEditorTool';
import { EditDeviceFileTool } from '../agent/tools/EditDeviceFileTool';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface RegisteredTool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

describe('WebMcpBridge', () => {
  let registeredTools: Map<string, RegisteredTool>;

  beforeEach(() => {
    registeredTools = new Map();

    // Mock document.modelContext for WebMCP
    const registerToolMock = vi.fn((toolObj: RegisteredTool) => {
      registeredTools.set(toolObj.name, toolObj);
      return () => {
        registeredTools.delete(toolObj.name);
      };
    });

    (document as unknown as { modelContext?: { registerTool: typeof registerToolMock } }).modelContext = {
      registerTool: registerToolMock,
    };
  });

  it('registers tools from ToolRegistry on mount', () => {
    const registry = new ToolRegistry();
    const bindings = {
      getEditorContent: () => 'hello world',
      replaceEditorRange: vi.fn(),
    };
    registry.register(new ReadEditorTool(() => bindings as unknown as ToolBindings));
    registry.register(new EditEditorTool(() => bindings as unknown as ToolBindings));

    render(
      <WebMcpBridge
        toolRegistry={registry}
        getEditorContent={() => 'hello world'}
        revealEditorRange={vi.fn()}
        readDeviceFile={async () => null}
        getBoardNotes={() => null}
      />,
    );

    expect(registeredTools.has('read_editor')).toBe(true);
    expect(registeredTools.has('edit_editor')).toBe(true);
  });

  it('executes read-only tool without opening dialog', async () => {
    const registry = new ToolRegistry();
    const bindings = {
      getEditorContent: () => 'current content',
    };
    registry.register(new ReadEditorTool(() => bindings as unknown as ToolBindings));

    render(
      <WebMcpBridge
        toolRegistry={registry}
        getEditorContent={() => 'current content'}
        revealEditorRange={vi.fn()}
        readDeviceFile={async () => null}
        getBoardNotes={() => null}
      />,
    );

    const readTool = registeredTools.get('read_editor')!;
    const result = await readTool.execute({});

    expect(result).toEqual({
      content: [{ type: 'text', text: 'current content' }],
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens approval dialog for edit_editor, supports Focus button, and executes on Approve', async () => {
    const registry = new ToolRegistry();
    let content = 'line 1\nline 2\nline 3';
    const replaceEditorRange = vi.fn((from: number, to: number, text: string) => {
      content = content.slice(0, from) + text + content.slice(to);
    });
    const bindings = {
      getEditorContent: () => content,
      replaceEditorRange,
    };
    registry.register(new EditEditorTool(() => bindings as unknown as ToolBindings));

    const revealEditorRange = vi.fn();

    render(
      <WebMcpBridge
        toolRegistry={registry}
        getEditorContent={() => content}
        revealEditorRange={revealEditorRange}
        readDeviceFile={async () => null}
        getBoardNotes={() => null}
      />,
    );

    const editTool = registeredTools.get('edit_editor')!;

    // Start execution asynchronously (blocks on user approval in dialog)
    const executePromise = editTool.execute({
      old_string: 'line 2',
      new_string: 'line TWO',
    });

    // Wait for the approval dialog to open
    const revealButton = await screen.findByRole('button', { name: 'Reveal' });
    expect(revealButton).toBeInTheDocument();

    // Click Reveal / Focus button
    await userEvent.click(revealButton);
    expect(revealEditorRange).toHaveBeenCalledWith(7, 13);

    // Click Approve button
    const approveButton = screen.getByRole('button', { name: 'Approve' });
    await userEvent.click(approveButton);

    const result = await executePromise;
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Editor updated.' }],
    });
    expect(replaceEditorRange).toHaveBeenCalledWith(7, 13, 'line TWO');
  });

  it('opens approval dialog for edit_device_file, supports Focus button, and rejects when user clicks Reject', async () => {
    const registry = new ToolRegistry();
    const deviceFs = {
      readBytes: vi.fn().mockResolvedValue(new TextEncoder().encode('a = 1\nb = 2\nc = 3')),
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    const bindings = {
      deviceFs,
      getEditorOrigin: () => ({ kind: 'file', path: '/main.py' }),
      setOriginAndContent: vi.fn(),
    };
    registry.register(new EditDeviceFileTool(() => bindings as unknown as ToolBindings));

    const focusDeviceFile = vi.fn();
    const readDeviceFile = vi.fn().mockResolvedValue('a = 1\nb = 2\nc = 3');

    render(
      <WebMcpBridge
        toolRegistry={registry}
        getEditorContent={() => ''}
        revealEditorRange={vi.fn()}
        readDeviceFile={readDeviceFile}
        getBoardNotes={() => null}
        focusDeviceFile={focusDeviceFile}
      />,
    );

    const editDeviceTool = registeredTools.get('edit_device_file')!;

    const executePromise = editDeviceTool.execute({
      path: '/main.py',
      old_string: 'b = 2',
      new_string: 'b = 20',
    });

    // Wait for the Focus button to load inside the dialog
    const focusButton = await screen.findByRole('button', { name: 'Focus' });
    expect(focusButton).toBeInTheDocument();

    // Click Focus button
    await userEvent.click(focusButton);
    expect(focusDeviceFile).toHaveBeenCalledWith('/main.py', 6, 11);

    // Click Reject button
    const rejectButton = screen.getByRole('button', { name: 'Reject' });
    await userEvent.click(rejectButton);

    const result = await executePromise;
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Tool execution rejected by user.' }],
      isError: true,
    });
    expect(deviceFs.writeText).not.toHaveBeenCalled();
  });
});
