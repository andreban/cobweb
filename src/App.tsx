// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentProvider, INLINE_APPROVAL } from '@mast-ai/react-ui';
import { AgentRunner } from '@mast-ai/core';
import { SplitPane } from './components/SplitPane';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { ReplShell } from './components/ReplShell';
import { CodeEditor } from './components/CodeEditor';
import { FileNavigator, type FileNavigatorHandle } from './components/FileNavigator';
import { DeviceFileNavigator } from './components/DeviceFileNavigator';
import { EditorBanner } from './components/EditorBanner';
import { SettingsPanel } from './components/SettingsPanel';
import { AgentPanel } from './components/AgentPanel';
import { makeCobwebApproval } from './components/makeCobwebApproval';
import { useReplConnection } from './hooks/useReplConnection';
import { useEditor, type EditorOrigin } from './hooks/useEditor';
import { useDeviceFs } from './hooks/useDeviceFs';
import { useLayout } from './hooks/useLayout';
import { useProviderConfig } from './hooks/useProviderConfig';
import { useTheme } from './hooks/useTheme';
import { createModels } from './models';
import { createAdapter } from './providers/factory';
import { PLANNING_AGENT } from './agent/config';
import { wireTools } from './agent/wireTools';
import { createDelegateToCoderTool } from './agent/tools/DelegateToCoderTool';
import { DeviceFs } from './DeviceFs';
import { saveEditor } from './lib/saveEditor';
import { dirname, join } from './lib/devicePath';

const models = createModels();

export function App() {
  const { connectionState, connect, disconnect, reset, runCode, sendRaw, send, onData, replHistory } =
    useReplConnection();
  const { config, save: saveConfig, clear: clearConfig } = useProviderConfig();
  const { theme, preference: themePreference, cycle: cycleTheme } = useTheme();
  const {
    editorRef,
    getContent,
    setContent,
    replaceRange,
    revealRange,
    origin,
    setOriginAndContent,
    isModified,
  } = useEditor(theme);

  const deviceFsHook = useDeviceFs({ connectionState, sendRaw });
  const {
    list: deviceList,
    readBytes: deviceReadBytes,
    writeText: deviceWriteText,
    writeBytes: deviceWriteBytes,
    mkdir: deviceMkdir,
    rename: deviceRename,
    removeFile: deviceRemoveFile,
    removeDir: deviceRemoveDir,
  } = deviceFsHook;

  const handleCreateDeviceFile = useCallback(
    async (parentPath: string, name: string) => {
      await deviceWriteText(join(parentPath, name), '');
    },
    [deviceWriteText],
  );

  const handleCreateDeviceDir = useCallback(
    async (parentPath: string, name: string) => {
      await deviceMkdir(join(parentPath, name));
    },
    [deviceMkdir],
  );

  const handleRenameDeviceEntry = useCallback(
    async (path: string, newName: string) => {
      await deviceRename(path, join(dirname(path), newName));
    },
    [deviceRename],
  );

  const handleDeleteDeviceFile = useCallback(
    async (path: string) => {
      await deviceRemoveFile(path);
    },
    [deviceRemoveFile],
  );

  const handleDeleteDeviceDir = useCallback(
    async (path: string, recursive: boolean) => {
      await deviceRemoveDir(path, { recursive });
    },
    [deviceRemoveDir],
  );

  const handleCountDeviceChildren = useCallback(
    async (path: string): Promise<number> => {
      const entries = await deviceList(path);
      return entries.length;
    },
    [deviceList],
  );

  const deviceFs = useMemo(
    () => (connectionState === 'connected' ? new DeviceFs(runCode) : null),
    [connectionState, runCode],
  );

  type BannerState =
    | { kind: 'pending-switch'; origin: EditorOrigin; content: string }
    | { kind: 'message'; message: string };
  const [banner, setBanner] = useState<BannerState | null>(null);

  const handleUploadToDevice = useCallback(
    async (parentPath: string, files: File[]): Promise<void> => {
      // List once per drop and reuse — multi-file drops to the same folder
      // are the common case and we want one round-trip, not N. Re-listing
      // after each successful write would catch self-collisions if the user
      // dropped two copies of the same name, but that's a degenerate case
      // and the user can resolve via the second confirm.
      let existingNames: Set<string>;
      try {
        existingNames = new Set((await deviceList(parentPath)).map((e) => e.name));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setBanner({ kind: 'message', message: `Upload failed: ${message}` });
        return;
      }
      for (const file of files) {
        if (existingNames.has(file.name)) {
          if (!window.confirm(`${file.name} already exists in ${parentPath}. Overwrite?`)) {
            continue;
          }
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          await deviceWriteBytes(join(parentPath, file.name), bytes);
          existingNames.add(file.name);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setBanner({ kind: 'message', message: `Upload failed: ${message}` });
          return;
        }
      }
    },
    [deviceList, deviceWriteBytes],
  );

  const handleShowDeviceMessage = useCallback((message: string) => {
    setBanner({ kind: 'message', message });
  }, []);

  const localNavRef = useRef<FileNavigatorHandle | null>(null);

  const handleDownloadFromDevice = useCallback(
    async (path: string): Promise<void> => {
      const handle = localNavRef.current;
      if (!handle) {
        // FileNavigator is always mounted, so a missing ref means React
        // hasn't attached yet — surface a clear toast rather than swallowing.
        setBanner({ kind: 'message', message: 'Local pane is not ready yet.' });
        return;
      }
      await handle.downloadFromDevice(path);
    },
    [],
  );

  const handleMoveOnDevice = useCallback(
    async (from: string, to: string): Promise<void> => {
      await deviceRename(from, to);
    },
    [deviceRename],
  );

  const handleSave = useCallback(async (): Promise<'saved' | 'cancelled' | 'noop'> => {
    return saveEditor(origin, getContent(), setOriginAndContent, deviceWriteText);
  }, [origin, getContent, setOriginAndContent, deviceWriteText]);

  const handleSaveClick = useCallback(() => {
    handleSave().catch((err) => console.error('Save failed:', err));
  }, [handleSave]);

  const handleOpenDeviceFile = useCallback(
    async (path: string) => {
      // Drop any stale banner from a previous open attempt; later branches
      // raise a new banner when needed (binary file, error, pending switch).
      setBanner(null);
      try {
        const bytes = await deviceReadBytes(path);
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (err) {
          if (err instanceof TypeError) {
            setBanner({ kind: 'message', message: 'Binary file — cannot open in editor.' });
            return;
          }
          throw err;
        }
        const newOrigin: EditorOrigin = { kind: 'device', path };
        if (isModified) {
          setBanner({ kind: 'pending-switch', origin: newOrigin, content: text });
          return;
        }
        setOriginAndContent(newOrigin, text);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setBanner({ kind: 'message', message: `Failed to open: ${message}` });
      }
    },
    [deviceReadBytes, isModified, setOriginAndContent],
  );

  const dismissBanner = useCallback(() => setBanner(null), []);

  const acceptPendingSwitch = useCallback(() => {
    if (banner?.kind !== 'pending-switch') return;
    setOriginAndContent(banner.origin, banner.content);
    setBanner(null);
  }, [banner, setOriginAndContent]);

  const saveAndAcceptPendingSwitch = useCallback(() => {
    if (banner?.kind !== 'pending-switch') return;
    const target = banner;
    handleSave()
      .then((result) => {
        if (result === 'cancelled') return;
        setOriginAndContent(target.origin, target.content);
        setBanner(null);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setBanner({ kind: 'message', message: `Save failed: ${message}` });
      });
  }, [banner, handleSave, setOriginAndContent]);

  // Banners reflect in-flight device-fs interactions (pending switch to a
  // device file, binary-file warning, open errors). On disconnect those
  // become stale — the target path is unreachable — so dismiss using the
  // documented "adjust state during render" pattern.
  const [prevIsAvailable, setPrevIsAvailable] = useState(deviceFsHook.isAvailable);
  if (prevIsAvailable !== deviceFsHook.isAvailable) {
    setPrevIsAvailable(deviceFsHook.isAvailable);
    if (!deviceFsHook.isAvailable && banner !== null) setBanner(null);
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveClick();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveClick]);

  // Register tool definitions during render — AgentProvider inspects the
  // registry on its first memo to decide whether to install the approval
  // proxy, so the tools (and their `requiresApproval` flags) must be in the
  // registry before the provider mounts. wireTools is idempotent: the first
  // call registers, every subsequent call only refreshes the bindings.
  wireTools(models.tools, {
    getEditorContent: getContent,
    setEditorContent: setContent,
    replaceEditorRange: replaceRange,
    runCode,
    getReplHistory: () => replHistory,
    onData,
    deviceFs,
    sendInterrupt: () => send('\x03'),
  });

  const runner = useMemo(() => {
    if (!config) return null;
    const adapter = createAdapter(config);
    return new AgentRunner(adapter, models.tools);
  }, [config]);

  // Sub-agent tool calls do not yet trigger onApprovalRequired —
  // AgentProvider's approval wrapping is private to its internal runner
  // (andreban/mast-ai#128). The coder's writes execute unguarded until
  // that upstream fix ships.
  useEffect(() => {
    if (!runner) return;
    if (models.tools.getTool('delegate_to_coder')) return;
    models.tools.register(createDelegateToCoderTool(runner));
  }, [runner]);

  const readDeviceFileForApproval = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        const bytes = await deviceReadBytes(path);
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          return null;
        }
      } catch {
        return null;
      }
    },
    [deviceReadBytes],
  );

  const renderApproval = useMemo(
    () => makeCobwebApproval(getContent, revealRange, readDeviceFileForApproval),
    [getContent, revealRange, readDeviceFileForApproval],
  );

  const savedConversation = useMemo(
    () => JSON.parse(localStorage.getItem('cobweb:conversation') ?? 'null') as {
      history: unknown[];
      entries: unknown[];
    } | null,
    [],
  );

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const {
    leftOpen,
    setLeftOpen,
    leftSize,
    setLeftSize,
    rightOpen,
    setRightOpen,
    rightSize,
    setRightSize,
    replOpen,
    setReplOpen,
    replSize,
    setReplSize,
    leftSplitSize,
    setLeftSplitSize,
  } = useLayout();

  return (
    <AgentProvider
      runner={runner}
      agent={PLANNING_AGENT}
      onApprovalRequired={async (toolCall) => {
        if (
          (toolCall.name === 'open_device_file_in_editor' ||
            toolCall.name === 'save_editor_to_device') &&
          deviceFs === null
        ) {
          return 'Device is not connected.';
        }
        return INLINE_APPROVAL;
      }}
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
          onRun={() => {
            // Click handler is `() => void`; without a `.catch` a rejection
            // (timeout, mid-run disconnect, …) would become an unhandled
            // promise rejection.
            runCode(getContent()).catch((err) => console.error('Run failed:', err));
          }}
          onStop={() => send('\x03')}
          onSave={handleSaveClick}
          saveEnabled={origin.kind !== 'device' || deviceFsHook.isAvailable}
          onOpenSettings={() => setIsSettingsOpen(true)}
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
              <SplitPane
                key="left"
                orientation="vertical"
                initialSize={leftSplitSize}
                size={leftSplitSize}
                onSizeChange={setLeftSplitSize}
              >
                {[
                  <FileNavigator
                    key="files"
                    ref={localNavRef}
                    onFileSelected={setContent}
                    onDeviceReadBytes={deviceReadBytes}
                    onShowMessage={handleShowDeviceMessage}
                  />,
                  <DeviceFileNavigator
                    key="device-files"
                    isAvailable={deviceFsHook.isAvailable}
                    tree={deviceFsHook.tree}
                    busy={deviceFsHook.busy}
                    onExpand={(p) => {
                      deviceFsHook.expand(p).catch((err) => console.error('Expand failed:', err));
                    }}
                    onCollapse={deviceFsHook.collapse}
                    onRefreshAll={() => {
                      deviceFsHook.refreshAll().catch((err) =>
                        console.error('Refresh failed:', err),
                      );
                    }}
                    onOpenFile={(p) => {
                      handleOpenDeviceFile(p).catch((err) =>
                        console.error('Open device file failed:', err),
                      );
                    }}
                    onCreateFile={handleCreateDeviceFile}
                    onCreateDir={handleCreateDeviceDir}
                    onRename={handleRenameDeviceEntry}
                    onDeleteFile={handleDeleteDeviceFile}
                    onDeleteDir={handleDeleteDeviceDir}
                    onCountChildren={handleCountDeviceChildren}
                    onUpload={handleUploadToDevice}
                    onDownloadRequest={handleDownloadFromDevice}
                    onMoveOnDevice={handleMoveOnDevice}
                    onShowMessage={handleShowDeviceMessage}
                  />,
                ]}
              </SplitPane>,
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
                      <div
                        key="editor"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          width: '100%',
                          height: '100%',
                        }}
                      >
                        {banner?.kind === 'pending-switch' && (
                          <EditorBanner
                            kind="pending-switch"
                            onSave={saveAndAcceptPendingSwitch}
                            onDiscard={acceptPendingSwitch}
                            onCancel={dismissBanner}
                          />
                        )}
                        {banner?.kind === 'message' && (
                          <EditorBanner
                            kind="message"
                            message={banner.message}
                            onDismiss={dismissBanner}
                          />
                        )}
                        <div style={{ flex: 1, minHeight: 0 }}>
                          <CodeEditor editorRef={editorRef} />
                        </div>
                      </div>,
                      <ReplShell key="repl" onData={onData} onInput={send} theme={theme} />,
                    ]}
                  </SplitPane>,
                  <AgentPanel
                    key="agent"
                    theme={theme}
                    inputPlaceholder="Ask the assistant…"
                    onResetConversation={() => localStorage.removeItem('cobweb:conversation')}
                    renderApproval={renderApproval}
                  />,
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
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSave={saveConfig}
        onClear={clearConfig}
      />
    </AgentProvider>
  );
}
