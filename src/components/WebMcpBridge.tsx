// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { Dialog } from '@base-ui/react/dialog';
import type { Tool, ToolRegistry } from '@mast-ai/core';
import type { PendingApproval, ToolEventEntry } from '@mast-ai/react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebMCP } from 'use-webmcp-tool';
import { CobwebApproval } from './CobwebApproval';

export interface WebMcpBridgeProps {
  toolRegistry: ToolRegistry;
  getEditorContent: () => string;
  revealEditorRange: (from: number, to: number) => void;
  readDeviceFile: (path: string) => Promise<string | null>;
  getBoardNotes: () => string | null;
  focusDeviceFile?: (path: string, from: number, to: number) => void | Promise<void>;
}

interface PendingWebMcpApproval {
  entry: ToolEventEntry;
  approval: PendingApproval;
}

interface WebMcpSingleToolProps {
  tool: Tool;
  requestApproval: (entry: ToolEventEntry) => Promise<boolean>;
}

function WebMcpSingleTool({ tool, requestApproval }: WebMcpSingleToolProps) {
  const def = tool.definition();

  useWebMCP({
    name: def.name,
    description: def.description,
    inputSchema: def.parameters,
    async execute(args: Record<string, unknown>) {
      if (def.requiresApproval) {
        const approved = await requestApproval({
          id: `webmcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: def.name,
          args: args ?? {},
        });
        if (!approved) {
          throw new Error('Tool execution rejected by user.');
        }
      }
      const result = await tool.call(args ?? {}, {});
      return result;
    },
  });

  return null;
}

export function WebMcpBridge({
  toolRegistry,
  getEditorContent,
  revealEditorRange,
  readDeviceFile,
  getBoardNotes,
  focusDeviceFile,
}: WebMcpBridgeProps) {
  const [tools, setTools] = useState<Tool[]>(() =>
    toolRegistry
      .getTools()
      .map((def) => toolRegistry.getTool(def.name))
      .filter((t): t is Tool => t !== undefined),
  );

  useEffect(() => {
    const updateTools = () => {
      setTools(
        toolRegistry
          .getTools()
          .map((def) => toolRegistry.getTool(def.name))
          .filter((t): t is Tool => t !== undefined),
      );
    };

    updateTools();

    toolRegistry.addEventListener('tool-registered', updateTools);
    toolRegistry.addEventListener('tool-unregistered', updateTools);

    return () => {
      toolRegistry.removeEventListener('tool-registered', updateTools);
      toolRegistry.removeEventListener('tool-unregistered', updateTools);
    };
  }, [toolRegistry]);

  const [pendingApproval, setPendingApproval] = useState<PendingWebMcpApproval | null>(null);
  const queueRef = useRef<Array<() => void>>([]);
  const activeRef = useRef<boolean>(false);

  const processNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (next) {
      next();
    } else {
      activeRef.current = false;
    }
  }, []);

  const requestApproval = useCallback(
    (entry: ToolEventEntry): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        const startApproval = () => {
          setPendingApproval({
            entry,
            approval: {
              status: 'pending',
              approve: () => {
                setPendingApproval(null);
                resolve(true);
                processNext();
              },
              reject: () => {
                setPendingApproval(null);
                resolve(false);
                processNext();
              },
            },
          });
        };

        if (!activeRef.current) {
          activeRef.current = true;
          startApproval();
        } else {
          queueRef.current.push(startApproval);
        }
      });
    },
    [processNext],
  );

  const isDialogOpen = pendingApproval !== null;

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && pendingApproval) {
      pendingApproval.approval.reject();
    }
  }, [pendingApproval]);

  return (
    <>
      {tools.map((tool) => (
        <WebMcpSingleTool
          key={tool.definition().name}
          tool={tool}
          requestApproval={requestApproval}
        />
      ))}

      <Dialog.Root open={isDialogOpen} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50 transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
          <Dialog.Popup
            aria-label="WebMCP Tool Confirmation"
            className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(42rem,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-card text-card-foreground shadow-xl outline-none transition-all duration-150 p-4 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:scale-95"
          >
            <Dialog.Title className="sr-only">WebMCP Tool Request</Dialog.Title>
            {pendingApproval && (
              <CobwebApproval
                entry={pendingApproval.entry}
                approval={pendingApproval.approval}
                getEditorContent={getEditorContent}
                revealEditorRange={revealEditorRange}
                readDeviceFile={readDeviceFile}
                getBoardNotes={getBoardNotes}
                focusDeviceFile={focusDeviceFile}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
