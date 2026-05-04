// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import '@mast-ai/react-ui/styles.css';
import { SplitPane } from './components/SplitPane';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';

function App() {
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connected'>(
    'disconnected',
  );

  const [leftOpen, setLeftOpen] = useState(true);
  const [leftSize, setLeftSize] = useState(20);

  const [rightOpen, setRightOpen] = useState(true);
  const [rightSize, setRightSize] = useState(35);

  const [replOpen, setReplOpen] = useState(true);
  const [replSize, setReplSize] = useState(40);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <Toolbar
        connectionState={connectionState}
        onConnect={() => setConnectionState('connected')}
        onDisconnect={() => setConnectionState('disconnected')}
        onReset={() => {}}
        onRun={() => {}}
        onOpenWorkspace={() => {}}
        onOpenSettings={() => {}}
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
            <div key="files" style={{ padding: 8, background: '#f3f4f6', height: '100%' }}>FileNavigator</div>,
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
                    <div key="editor" style={{ padding: 8, background: '#fff', height: '100%' }}>CodeEditor</div>,
                    <div key="repl" style={{ padding: 8, background: '#1e1e1e', color: '#fff', height: '100%' }}>ReplShell</div>,
                  ]}
                </SplitPane>,
                <div key="agent" style={{ padding: 8, background: '#f9fafb', height: '100%' }}>ConversationPanel</div>,
              ]}
            </SplitPane>,
          ]}
        </SplitPane>
      </div>
      <StatusBar
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
