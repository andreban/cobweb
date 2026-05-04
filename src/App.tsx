// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { AgentProvider, ConversationPanel, INLINE_APPROVAL } from '@mast-ai/react-ui';
import { AgentRunner } from '@mast-ai/core';
import { SplitPane } from './components/SplitPane';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { ReplShell } from './components/ReplShell';
import { CodeEditor } from './components/CodeEditor';
import { FileNavigator } from './components/FileNavigator';
import { useReplConnection } from './hooks/useReplConnection';
import { useEditor } from './hooks/useEditor';
import { useProviderConfig } from './hooks/useProviderConfig';
import { useTheme } from './hooks/useTheme';
import { createModels } from './models';
import { createAdapter } from './providers/factory';
import { CODING_AGENT } from './agent/config';

const models = createModels();

export function App() {
  const { connectionState, connect, disconnect, reset, runCode, send, onData } =
    useReplConnection();
  const { config } = useProviderConfig();
  const { theme, preference: themePreference, cycle: cycleTheme } = useTheme();
  const { editorRef, getContent, setContent } = useEditor(theme);

  const runner = useMemo(() => {
    if (!config) return null;
    const adapter = createAdapter(config);
    return new AgentRunner(adapter, models.tools);
  }, [config]);

  const savedConversation = useMemo(
    () => JSON.parse(localStorage.getItem('cobweb:conversation') ?? 'null') as {
      history: unknown[];
      entries: unknown[];
    } | null,
    [],
  );

  const [leftOpen, setLeftOpen] = useState(true);
  const [leftSize, setLeftSize] = useState(20);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightSize, setRightSize] = useState(35);
  const [replOpen, setReplOpen] = useState(true);
  const [replSize, setReplSize] = useState(40);

  return (
    <AgentProvider
      runner={runner}
      agent={CODING_AGENT}
      disableRoot={true}
      onApprovalRequired={async (call) => (call.name === 'run_code' ? INLINE_APPROVAL : true)}
      onConversationChange={(history, entries) => {
        localStorage.setItem('cobweb:conversation', JSON.stringify({ history, entries }));
      }}
      initialHistory={savedConversation?.history as never}
      initialEntries={savedConversation?.entries as never}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        <Toolbar
          connectionState={connectionState}
          onConnect={connect}
          onDisconnect={disconnect}
          onReset={reset}
          onRun={() => runCode(getContent())}
          onOpenSettings={() => {}}
          isAgentConfigured={config !== null}
          themePreference={themePreference}
          onCycleTheme={cycleTheme}
        />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SplitPane
            orientation="horizontal"
            initialSize={leftSize}
            size={leftOpen ? leftSize : 0}
            onSizeChange={setLeftSize}
            collapsed={!leftOpen}
          >
            {[
              <FileNavigator key="files" onFileSelected={setContent} />,
              <SplitPane
                key="main"
                orientation="horizontal"
                initialSize={100 - rightSize}
                size={rightOpen ? 100 - rightSize : 100}
                onSizeChange={(s) => setRightSize(100 - s)}
                collapsed={!rightOpen}
              >
                {[
                  <SplitPane
                    key="center"
                    orientation="vertical"
                    initialSize={100 - replSize}
                    size={replOpen ? 100 - replSize : 100}
                    onSizeChange={(s) => setReplSize(100 - s)}
                    collapsed={!replOpen}
                  >
                    {[
                      <CodeEditor key="editor" editorRef={editorRef} />,
                      <ReplShell key="repl" onData={onData} onInput={send} theme={theme} />,
                    ]}
                  </SplitPane>,
                  <ConversationPanel key="agent" inputPlaceholder="Ask the assistant…" theme={theme} />,
                ]}
              </SplitPane>,
            ]}
          </SplitPane>
        </div>
        <StatusBar
          connectionState={connectionState}
          isAgentConfigured={config !== null}
          leftOpen={leftOpen}
          replOpen={replOpen}
          rightOpen={rightOpen}
          onToggleLeft={() => setLeftOpen((o) => !o)}
          onToggleRepl={() => setReplOpen((o) => !o)}
          onToggleRight={() => setRightOpen((o) => !o)}
        />
      </div>
    </AgentProvider>
  );
}
