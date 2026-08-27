// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { diffLines, diffWords, type ChangeObject } from 'diff';
import {
  InlineApproval,
  type PendingApproval,
  type ToolEventEntry,
} from '@mast-ai/react-ui';
import { findUniqueOccurrence, expandToContextLines } from '../lib/editApproval';

interface ApprovalSlotProps {
  entry: ToolEventEntry;
  approval: PendingApproval;
}

interface CobwebApprovalProps extends ApprovalSlotProps {
  getEditorContent: () => string;
  revealEditorRange: (from: number, to: number) => void;
  readDeviceFile: (path: string) => Promise<string | null>;
  getBoardNotes: () => string | null;
  focusDeviceFile?: (path: string, from: number, to: number) => void | Promise<void>;
}

export function CobwebApproval({
  entry,
  approval,
  getEditorContent,
  revealEditorRange,
  readDeviceFile,
  getBoardNotes,
  focusDeviceFile,
}: CobwebApprovalProps): ReactNode {
  switch (entry.name) {
    case 'edit_editor':
      return (
        <EditApprovalCard
          entry={entry}
          approval={approval}
          surface="editor"
          headerLabel={<>Edit editor</>}
          source={getEditorContent()}
          revealRange={revealEditorRange}
        />
      );
    case 'edit_device_file':
      return (
        <DeviceEditApprovalLoader
          entry={entry}
          approval={approval}
          readDeviceFile={readDeviceFile}
          focusDeviceFile={focusDeviceFile}
        />
      );
    case 'edit_board_notes': {
      const current = getBoardNotes();
      if (current === null) {
        return (
          <NoBoardApprovalCard
            entry={entry}
            approval={approval}
            header={<>Edit board notes</>}
          />
        );
      }
      return (
        <EditApprovalCard
          entry={entry}
          approval={approval}
          surface="notes"
          headerLabel={<>Edit board notes</>}
          source={current}
        />
      );
    }
    case 'write_board_notes': {
      const wbnArgs = entry.args as { content?: unknown } | undefined;
      const wbnContent =
        typeof wbnArgs?.content === 'string' ? wbnArgs.content : '';
      const wbnCurrent = getBoardNotes();
      if (wbnCurrent === null) {
        return (
          <NoBoardApprovalCard
            entry={entry}
            approval={approval}
            header={<>Save board notes</>}
          />
        );
      }
      return (
        <NotesWriteApprovalCard
          entry={entry}
          approval={approval}
          current={wbnCurrent}
          proposed={wbnContent}
        />
      );
    }
    case 'write_editor': {
      const weArgs = entry.args as { code?: unknown } | undefined;
      const code = typeof weArgs?.code === 'string' ? weArgs.code : '';
      return (
        <WriteApprovalCard
          entry={entry}
          approval={approval}
          header="Replace editor with new content"
          content={code}
        />
      );
    }
    case 'write_device_file': {
      const wdfArgs = entry.args as { path?: unknown; content?: unknown } | undefined;
      const wdfPath = typeof wdfArgs?.path === 'string' ? wdfArgs.path : '';
      const wdfContent = typeof wdfArgs?.content === 'string' ? wdfArgs.content : '';
      return (
        <WriteApprovalCard
          entry={entry}
          approval={approval}
          header={<>Write <code>{wdfPath}</code></>}
          content={wdfContent}
        />
      );
    }
    case 'open_device_file_in_editor': {
      const odfArgs = entry.args as { path?: unknown } | undefined;
      const odfPath = typeof odfArgs?.path === 'string' ? odfArgs.path : '';
      return (
        <OpenDeviceFileApprovalLoader
          entry={entry}
          approval={approval}
          path={odfPath}
          readDeviceFile={readDeviceFile}
        />
      );
    }
    case 'save_editor_to_device': {
      const setdArgs = entry.args as { path?: unknown } | undefined;
      const setdPath = typeof setdArgs?.path === 'string' ? setdArgs.path : '';
      return (
        <WriteApprovalCard
          entry={entry}
          approval={approval}
          header={<>Save editor to <code>{setdPath}</code></>}
          content={getEditorContent()}
        />
      );
    }
    case 'delete_device_file': {
      const ddfArgs = entry.args as { path?: unknown } | undefined;
      const ddfPath = typeof ddfArgs?.path === 'string' ? ddfArgs.path : '';
      return (
        <ConfirmApprovalCard
          entry={entry}
          approval={approval}
          header={<>Delete <code>{ddfPath}</code></>}
          destructive
        />
      );
    }
    case 'make_device_dir': {
      const mddArgs = entry.args as { path?: unknown } | undefined;
      const mddPath = typeof mddArgs?.path === 'string' ? mddArgs.path : '';
      return (
        <ConfirmApprovalCard
          entry={entry}
          approval={approval}
          header={<>Create directory <code>{mddPath}</code></>}
        />
      );
    }
    case 'run_editor': {
      return (
        <RunApprovalCard
          entry={entry}
          approval={approval}
          header="Run editor code on microcontroller"
          content={getEditorContent()}
        />
      );
    }
    case 'run_device_file': {
      const rdfArgs = entry.args as { path?: unknown } | undefined;
      const rdfPath = typeof rdfArgs?.path === 'string' ? rdfArgs.path : '';
      return (
        <RunDeviceFileApprovalLoader
          entry={entry}
          approval={approval}
          path={rdfPath}
          readDeviceFile={readDeviceFile}
        />
      );
    }
    case 'run_snippet': {
      const rsArgs = entry.args as { code?: unknown } | undefined;
      const rsCode = typeof rsArgs?.code === 'string' ? rsArgs.code : '';
      return (
        <RunApprovalCard
          entry={entry}
          approval={approval}
          header="Execute code snippet on microcontroller"
          content={rsCode}
        />
      );
    }
    default:
      return (
        <InlineApproval
          entry={entry}
          approve={approval.approve}
          reject={approval.reject}
        />
      );
  }
}

// ----- DeviceEditApprovalLoader ---------------------------------------------

interface DeviceEditApprovalLoaderProps extends ApprovalSlotProps {
  readDeviceFile: (path: string) => Promise<string | null>;
  focusDeviceFile?: (path: string, from: number, to: number) => void | Promise<void>;
}

function DeviceEditApprovalLoader({
  entry,
  approval,
  readDeviceFile,
  focusDeviceFile,
}: DeviceEditApprovalLoaderProps): ReactNode {
  const args = entry.args as { path?: unknown } | undefined;
  const path = typeof args?.path === 'string' ? args.path : '';

  type LoadState =
    | { kind: 'loading' }
    | { kind: 'loaded'; source: string }
    | { kind: 'failed' };
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    readDeviceFile(path).then((source) => {
      if (cancelled) return;
      if (source === null) {
        setState({ kind: 'failed' });
      } else {
        setState({ kind: 'loaded', source });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, readDeviceFile]);

  const headerLabel = (
    <>
      Edit <code>{path}</code>
    </>
  );

  if (state.kind === 'loading') {
    return (
      <div className="cobweb-approval-card" data-tool-name={entry.name}>
        <div className="cobweb-approval-header">
          <span className="cobweb-approval-title">{headerLabel}</span>
          <span className="cobweb-approval-status">requires approval</span>
        </div>
        <div className="cobweb-approval-notice">
          <p>Loading file…</p>
        </div>
        <ApprovalActions
          approveDisabled
          onApprove={approval.approve}
          onReject={approval.reject}
        />
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="cobweb-approval-card" data-tool-name={entry.name}>
        <div className="cobweb-approval-header">
          <span className="cobweb-approval-title">{headerLabel}</span>
          <span className="cobweb-approval-status">requires approval</span>
        </div>
        <NoLongerAppliesNotice
          message="Cannot edit binary file."
          respondMessage="Cannot edit binary file."
          onRespondWith={approval.reject}
        />
        <ApprovalActions
          approveDisabled
          onApprove={approval.approve}
          onReject={approval.reject}
        />
      </div>
    );
  }

  return (
    <EditApprovalCard
      entry={entry}
      approval={approval}
      surface="file"
      headerLabel={headerLabel}
      source={state.source}
      onFocus={
        focusDeviceFile
          ? (from, to) => {
              void focusDeviceFile(path, from, to);
            }
          : undefined
      }
    />
  );
}

// ----- OpenDeviceFileApprovalLoader -----------------------------------------

interface OpenDeviceFileApprovalLoaderProps extends ApprovalSlotProps {
  path: string;
  readDeviceFile: (path: string) => Promise<string | null>;
}

function OpenDeviceFileApprovalLoader({
  entry,
  approval,
  path,
  readDeviceFile,
}: OpenDeviceFileApprovalLoaderProps): ReactNode {
  type LoadState =
    | { kind: 'loading' }
    | { kind: 'loaded'; content: string }
    | { kind: 'failed' };
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    readDeviceFile(path).then((content) => {
      if (cancelled) return;
      if (content === null) {
        setState({ kind: 'failed' });
      } else {
        setState({ kind: 'loaded', content });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, readDeviceFile]);

  const header = (
    <>
      Open <code>{path}</code> in editor
    </>
  );

  if (state.kind === 'loading') {
    return (
      <div className="cobweb-approval-card" data-tool-name={entry.name}>
        <div className="cobweb-approval-header">
          <span className="cobweb-approval-title">{header}</span>
          <span className="cobweb-approval-status">requires approval</span>
        </div>
        <div className="cobweb-approval-notice">
          <p>Loading file…</p>
        </div>
        <ApprovalActions
          approveDisabled
          onApprove={approval.approve}
          onReject={approval.reject}
        />
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="cobweb-approval-card" data-tool-name={entry.name}>
        <div className="cobweb-approval-header">
          <span className="cobweb-approval-title">{header}</span>
          <span className="cobweb-approval-status">requires approval</span>
        </div>
        <NoLongerAppliesNotice
          message="File preview unavailable."
          respondMessage="File preview unavailable."
          onRespondWith={approval.reject}
        />
        <ApprovalActions
          approveDisabled
          onApprove={approval.approve}
          onReject={approval.reject}
        />
      </div>
    );
  }

  return (
    <WriteApprovalCard
      entry={entry}
      approval={approval}
      header={header}
      content={state.content}
    />
  );
}

// ----- RunDeviceFileApprovalLoader ------------------------------------------

interface RunDeviceFileApprovalLoaderProps extends ApprovalSlotProps {
  path: string;
  readDeviceFile: (path: string) => Promise<string | null>;
}

function RunDeviceFileApprovalLoader({
  entry,
  approval,
  path,
  readDeviceFile,
}: RunDeviceFileApprovalLoaderProps): ReactNode {
  type LoadState =
    | { kind: 'loading' }
    | { kind: 'loaded'; content: string }
    | { kind: 'failed' };
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    readDeviceFile(path).then((content) => {
      if (cancelled) return;
      if (content === null) {
        setState({ kind: 'failed' });
      } else {
        setState({ kind: 'loaded', content });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, readDeviceFile]);

  const header = (
    <>
      Run <code>{path}</code> on microcontroller
    </>
  );

  if (state.kind === 'loading') {
    return (
      <div className="cobweb-approval-card" data-tool-name={entry.name}>
        <div className="cobweb-approval-header">
          <span className="cobweb-approval-title">{header}</span>
          <span className="cobweb-approval-status">requires approval</span>
        </div>
        <div className="cobweb-approval-notice">
          <p>Loading file preview…</p>
        </div>
        <ApprovalActions
          approveDisabled
          onApprove={approval.approve}
          onReject={approval.reject}
        />
      </div>
    );
  }

  return (
    <RunApprovalCard
      entry={entry}
      approval={approval}
      header={header}
      content={state.kind === 'loaded' ? state.content : '(file content preview unavailable)'}
    />
  );
}

// ----- EditApprovalCard ------------------------------------------------------

interface EditApprovalCardProps extends ApprovalSlotProps {
  source: string;
  surface: 'editor' | 'file' | 'notes';
  headerLabel: ReactNode;
  revealRange?: (from: number, to: number) => void;
  onFocus?: (from: number, to: number) => void;
}

function EditApprovalCard({
  entry,
  approval,
  source,
  surface,
  headerLabel,
  revealRange,
  onFocus,
}: EditApprovalCardProps): ReactNode {
  const args = entry.args as { old_string?: unknown; new_string?: unknown } | undefined;
  const oldString = typeof args?.old_string === 'string' ? args.old_string : '';
  const newString = typeof args?.new_string === 'string' ? args.new_string : '';

  const find = useMemo(
    () => findUniqueOccurrence(source, oldString),
    [source, oldString],
  );

  // Auto-reveal once when the card mounts so the user immediately sees
  // which part of the buffer the agent is asking about. We deliberately
  // don't repeat on every change to `find.index` — the user is typing then
  // and an unsolicited scroll would steal their focus.
  const didReveal = useRef(false);
  useEffect(() => {
    if (didReveal.current) return;
    if (find.kind !== 'unique') return;
    if (!revealRange) return;
    didReveal.current = true;
    revealRange(find.index, find.index + oldString.length);
  }, [find, oldString.length, revealRange]);

  const surfaceWord =
    surface === 'editor' ? 'editor' : surface === 'notes' ? 'notes' : 'file';
  const surfaceContainer =
    surface === 'editor' ? 'buffer' : surface === 'notes' ? 'notes' : 'file';
  const missingNotice = `old_string was not found in the current ${surfaceWord} — the ${surfaceContainer} may have changed since the agent proposed this edit.`;
  const missingRespond = `old_string not found in ${surfaceWord}.`;
  const ambiguousNotice = (count: number) =>
    `old_string is now ambiguous — it appears ${count} times in the current ${surfaceWord}.`;
  const ambiguousRespond = (count: number) =>
    `old_string is ambiguous — appears ${count} times. Include more surrounding context.`;

  return (
    <div className="cobweb-approval-card" data-tool-name={entry.name}>
      <div className="cobweb-approval-header">
        <span className="cobweb-approval-title">{headerLabel}</span>
        <div className="cobweb-approval-header-actions">
          {find.kind === 'unique' && (revealRange || onFocus) && (
            <button
              type="button"
              className="cobweb-reveal-button"
              onClick={() => {
                if (onFocus) {
                  onFocus(find.index, find.index + oldString.length);
                } else if (revealRange) {
                  revealRange(find.index, find.index + oldString.length);
                }
              }}
              title={onFocus ? 'Open in editor and highlight changes' : 'Scroll editor to this location'}
            >
              {onFocus ? 'Focus' : 'Reveal'}
            </button>
          )}
          <span className="cobweb-approval-status">requires approval</span>
        </div>
      </div>

      {find.kind === 'unique' ? (
        <DiffBlock
          source={source}
          index={find.index}
          oldString={oldString}
          newString={newString}
        />
      ) : find.kind === 'missing' ? (
        <NoLongerAppliesNotice
          message={missingNotice}
          respondMessage={missingRespond}
          onRespondWith={approval.reject}
        />
      ) : (
        <NoLongerAppliesNotice
          message={ambiguousNotice(find.count)}
          respondMessage={ambiguousRespond(find.count)}
          onRespondWith={approval.reject}
        />
      )}

      <ApprovalActions
        approveDisabled={find.kind !== 'unique'}
        onApprove={approval.approve}
        onReject={approval.reject}
      />
    </div>
  );
}

// ----- NotesWriteApprovalCard ------------------------------------------------

interface NotesWriteApprovalCardProps extends ApprovalSlotProps {
  current: string;
  proposed: string;
}

function NotesWriteApprovalCard({
  entry,
  approval,
  current,
  proposed,
}: NotesWriteApprovalCardProps): ReactNode {
  return (
    <div className="cobweb-approval-card" data-tool-name={entry.name}>
      <div className="cobweb-approval-header">
        <span className="cobweb-approval-title">Save board notes</span>
        <span className="cobweb-approval-status">requires approval</span>
      </div>
      <UnifiedDiffBlock current={current} proposed={proposed} />
      <ApprovalActions onApprove={approval.approve} onReject={approval.reject} />
    </div>
  );
}

// ----- NoBoardApprovalCard --------------------------------------------------

interface NoBoardApprovalCardProps extends ApprovalSlotProps {
  header: ReactNode;
}

function NoBoardApprovalCard({
  entry,
  approval,
  header,
}: NoBoardApprovalCardProps): ReactNode {
  return (
    <div className="cobweb-approval-card" data-tool-name={entry.name}>
      <div className="cobweb-approval-header">
        <span className="cobweb-approval-title">{header}</span>
        <span className="cobweb-approval-status">requires approval</span>
      </div>
      <NoLongerAppliesNotice
        message="No board connected — cannot preview or save notes."
        respondMessage="No board connected. Notes are scoped per-board."
        onRespondWith={approval.reject}
      />
      <ApprovalActions
        approveDisabled
        onApprove={approval.approve}
        onReject={approval.reject}
      />
    </div>
  );
}

// ----- WriteApprovalCard ----------------------------------------------------

interface WriteApprovalCardProps extends ApprovalSlotProps {
  header: ReactNode;
  content: string;
}

function WriteApprovalCard({ entry, approval, header, content }: WriteApprovalCardProps): ReactNode {
  return (
    <div className="cobweb-approval-card" data-tool-name={entry.name}>
      <div className="cobweb-approval-header">
        <span className="cobweb-approval-title">{header}</span>
        <span className="cobweb-approval-status">requires approval</span>
      </div>
      <pre className="cobweb-approval-preview">{content}</pre>
      <ApprovalActions onApprove={approval.approve} onReject={approval.reject} />
    </div>
  );
}

// ----- RunApprovalCard ------------------------------------------------------

interface RunApprovalCardProps extends ApprovalSlotProps {
  header: ReactNode;
  content: string;
}

function RunApprovalCard({ entry, approval, header, content }: RunApprovalCardProps): ReactNode {
  return (
    <div className="cobweb-approval-card" data-tool-name={entry.name}>
      <div className="cobweb-approval-header">
        <span className="cobweb-approval-title">{header}</span>
        <span className="cobweb-approval-status">requires approval</span>
      </div>
      <pre className="cobweb-approval-preview">{content || '(empty)'}</pre>
      <ApprovalActions onApprove={approval.approve} onReject={approval.reject} />
    </div>
  );
}

// ----- ConfirmApprovalCard --------------------------------------------------

interface ConfirmApprovalCardProps extends ApprovalSlotProps {
  header: ReactNode;
  destructive?: boolean;
}

function ConfirmApprovalCard({ entry, approval, header, destructive = false }: ConfirmApprovalCardProps): ReactNode {
  return (
    <div className="cobweb-approval-card" data-tool-name={entry.name}>
      <div className="cobweb-approval-header">
        <span className="cobweb-approval-title">{header}</span>
        <span className="cobweb-approval-status">requires approval</span>
      </div>
      <ApprovalActions
        destructiveApprove={destructive}
        onApprove={approval.approve}
        onReject={approval.reject}
      />
    </div>
  );
}

// ----- Diff rendering --------------------------------------------------------

function DiffBlock({
  source,
  index,
  oldString,
  newString,
}: {
  source: string;
  index: number;
  oldString: string;
  newString: string;
}) {
  const expanded = useMemo(
    () => expandToContextLines(source, index, oldString, newString, 3),
    [source, index, oldString, newString],
  );

  const wordDiff = useMemo(
    () => diffWords(oldString, newString),
    [oldString, newString],
  );

  return (
    <div className="cobweb-diff-container">
      {expanded.contextBefore.length < index && <div className="cobweb-diff-ellipsis">…</div>}
      {expanded.contextBefore.map((line, i) => (
        <div key={`pre-${i}`} className="cobweb-diff-line cobweb-diff-line-ctx">
          <span className="cobweb-diff-line-number">
            {expanded.firstLine + i}
          </span>
          <span className="cobweb-diff-line-content">{line}</span>
        </div>
      ))}
      <div className="cobweb-diff-line cobweb-diff-line-del">
        <span className="cobweb-diff-line-number">-</span>
        <span className="cobweb-diff-line-content">
          {wordDiff.map((part, i) => {
            if (part.added) return null;
            if (part.removed) {
              return (
                <mark key={i} className="cobweb-diff-word-del">
                  {part.value}
                </mark>
              );
            }
            return part.value;
          })}
        </span>
      </div>
      <div className="cobweb-diff-line cobweb-diff-line-add">
        <span className="cobweb-diff-line-number">+</span>
        <span className="cobweb-diff-line-content">
          {wordDiff.map((part, i) => {
            if (part.removed) return null;
            if (part.added) {
              return (
                <mark key={i} className="cobweb-diff-word-add">
                  {part.value}
                </mark>
              );
            }
            return part.value;
          })}
        </span>
      </div>
      {expanded.contextAfter.map((line, i) => (
        <div key={`post-${i}`} className="cobweb-diff-line cobweb-diff-line-ctx">
          <span className="cobweb-diff-line-number">
            {expanded.firstLine +
              expanded.contextBefore.length +
              expanded.before.length +
              i}
          </span>
          <span className="cobweb-diff-line-content">{line}</span>
        </div>
      ))}
      {expanded.contextAfter.length > 0 && <div className="cobweb-diff-ellipsis">…</div>}
    </div>
  );
}

function UnifiedDiffBlock({ current, proposed }: { current: string; proposed: string }) {
  const lineDiff = useMemo(() => diffLines(current, proposed), [current, proposed]);

  return (
    <div className="cobweb-diff-container">
      {lineDiff.map((part: ChangeObject, i: number) => {
        const className = part.added
          ? 'cobweb-diff-line cobweb-diff-line-add'
          : part.removed
            ? 'cobweb-diff-line cobweb-diff-line-del'
            : 'cobweb-diff-line cobweb-diff-line-ctx';
        const prefix = part.added ? '+' : part.removed ? '-' : ' ';
        return (
          <div key={i} className={className}>
            <span className="cobweb-diff-line-number">{prefix}</span>
            <span className="cobweb-diff-line-content">{part.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function ApprovalActions({
  approveDisabled = false,
  destructiveApprove = false,
  onApprove,
  onReject,
}: {
  approveDisabled?: boolean;
  destructiveApprove?: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="cobweb-approval-actions">
      <button
        type="button"
        className={`cobweb-approval-button ${
          destructiveApprove ? 'cobweb-approval-button-destructive' : 'cobweb-approval-button-primary'
        }`}
        disabled={approveDisabled}
        onClick={onApprove}
      >
        Approve
      </button>
      <button
        type="button"
        className="cobweb-approval-button cobweb-approval-button-secondary"
        onClick={onReject}
      >
        Reject
      </button>
    </div>
  );
}

function NoLongerAppliesNotice({
  message,
  respondMessage,
  onRespondWith,
}: {
  message: string;
  respondMessage: string;
  onRespondWith: (msg: string) => void;
}) {
  return (
    <div className="cobweb-approval-notice">
      <p>{message}</p>
      <button
        type="button"
        className="cobweb-approval-button cobweb-approval-button-secondary"
        onClick={() => onRespondWith(respondMessage)}
      >
        Send notice to agent
      </button>
    </div>
  );
}
