// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import '@mast-ai/react-ui/styles.css';
import { SplitPane } from './components/SplitPane';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { ReplShell } from './components/ReplShell';
import { CodeEditor } from './components/CodeEditor';
import { FileNavigator } from './components/FileNavigator';
import { useReplConnection } from './hooks/useReplConnection';
import { useEditor } from './hooks/useEditor';

function App() {
  const { connectionState, connect, disconnect, reset, runCode, send, onData } =
    useReplConnection();
  const { editorRef, getContent, setContent } = useEditor();

  const [leftOpen, setLeftOpen] = useState(true);
  const [leftSize, setLeftSize] = useState(20);

  const [rightOpen, setRightOpen] = useState(true);
  const [rightSize, setRightSize] = useState(35);

  const [replOpen, setReplOpen] = useState(true);
  const [replSize, setReplSize] = useState(40);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('cobweb:theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('cobweb:theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <Toolbar
        connectionState={connectionState}
        onConnect={connect}
        onDisconnect={disconnect}
        onReset={reset}
        onRun={() => runCode(getContent())}
        onOpenSettings={() => {}}
        isAgentConfigured={false}
        theme={theme}
        onToggleTheme={toggleTheme}
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
                    <ReplShell key="repl" onData={onData} onInput={send} />,
                  ]}
                </SplitPane>,
                <div key="agent" style={{ padding: 8, background: '#f9fafb', height: '100%' }}>ConversationPanel</div>,
              ]}
            </SplitPane>,
          ]}
        </SplitPane>
      </div>
      <StatusBar
        connectionState={connectionState}
        isAgentConfigured={false}
        leftOpen={leftOpen}
        replOpen={replOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((o) => !o)}
        onToggleRepl={() => setReplOpen((o) => !o)}
        onToggleRight={() => setRightOpen((o) => !o)}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
