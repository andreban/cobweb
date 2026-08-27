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

interface DiffBlockProps {
  source: string;
  index: number;
  oldString: string;
  newString: string;
}

function DiffBlock({ source, index, oldString, newString }: DiffBlockProps): ReactNode {
  const hunk = useMemo(
    () => expandToContextLines(source, index, oldString, newString),
    [source, index, oldString, newString],
  );
  const wordDiff = useMemo(
    () => diffWords(hunk.before.join('\n'), hunk.after.join('\n')),
    [hunk.before, hunk.after],
  );

  const beforeRows = splitByNewline(renderHalf(wordDiff, 'removed'));
  const afterRows = splitByNewline(renderHalf(wordDiff, 'added'));

  // Line numbers are 1-based and reference the *source* buffer.
  const ctxBeforeStart = hunk.firstLine;
  const removedStart = ctxBeforeStart + hunk.contextBefore.length;
  const ctxAfterStart = removedStart + hunk.before.length;

  return (
    <pre className="cobweb-diff">
      {hunk.contextBefore.map((line, i) => (
        <DiffLine key={`ctx-before-${i}`} kind="context" lineNumber={ctxBeforeStart + i}>
          {line}
        </DiffLine>
      ))}
      {beforeRows.map((parts, i) => (
        <DiffLine key={`removed-${i}`} kind="removed" lineNumber={removedStart + i}>
          {parts}
        </DiffLine>
      ))}
      {/* Replacement lines have no source line numbers — leave the gutter
          blank so the column stays a stable reference to the current buffer. */}
      {afterRows.map((parts, i) => (
        <DiffLine key={`added-${i}`} kind="added" lineNumber={null}>
          {parts}
        </DiffLine>
      ))}
      {hunk.contextAfter.map((line, i) => (
        <DiffLine key={`ctx-after-${i}`} kind="context" lineNumber={ctxAfterStart + i}>
          {line}
        </DiffLine>
      ))}
    </pre>
  );
}

// ----- UnifiedDiffBlock ------------------------------------------------------

interface UnifiedDiffBlockProps {
  current: string;
  proposed: string;
}

/**
 * Whole-content diff for tools that replace an entire blob (e.g.
 * `write_board_notes`). Uses `diffLines` so the user sees what's changing
 * without having to read the full new content end-to-end.
 */
function UnifiedDiffBlock({ current, proposed }: UnifiedDiffBlockProps): ReactNode {
  const changes = useMemo(() => diffLines(current, proposed), [current, proposed]);

  // Track the running line numbers in the *current* (left) and *proposed*
  // (right) versions so each row can show its source-side line number.
  // Lines added by the change have no left-side number; removed lines have
  // no right-side number — we render the left number for removed/context
  // and leave it blank for added rows, matching `DiffBlock`.
  let leftLine = 1;
  const rows: ReactNode[] = [];
  let key = 0;
  for (const change of changes) {
    const lines = change.value.split('\n');
    // `diffLines` chunks end with the trailing newline included, so the
    // split yields a final empty string we should drop to avoid a phantom
    // blank row per chunk.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      if (change.added) {
        rows.push(
          <DiffLine key={`u-${key++}`} kind="added" lineNumber={null}>
            {line}
          </DiffLine>,
        );
      } else if (change.removed) {
        rows.push(
          <DiffLine key={`u-${key++}`} kind="removed" lineNumber={leftLine++}>
            {line}
          </DiffLine>,
        );
      } else {
        rows.push(
          <DiffLine key={`u-${key++}`} kind="context" lineNumber={leftLine++}>
            {line}
          </DiffLine>,
        );
      }
    }
  }

  return <pre className="cobweb-diff">{rows}</pre>;
}

function renderHalf(changes: ChangeObject<string>[], side: 'removed' | 'added'): ReactNode[] {
  // Build inline nodes that, when joined and split on `\n`, produce one
  // visual line per source/replacement line.
  const out: ReactNode[] = [];
  changes.forEach((change, i) => {
    if (change.added) {
      if (side === 'added') {
        out.push(
          <span key={i} className="cobweb-diff-added-word">
            {change.value}
          </span>,
        );
      }
      return;
    }
    if (change.removed) {
      if (side === 'removed') {
        out.push(
          <span key={i} className="cobweb-diff-removed-word">
            {change.value}
          </span>,
        );
      }
      return;
    }
    out.push(<span key={i}>{change.value}</span>);
  });
  return out;
}

function splitByNewline(nodes: ReactNode[]): ReactNode[][] {
  // Walk every span; split its text content on '\n' and emit a fresh row each
  // time we cross a newline. Highlighted spans are split into per-line pieces
  // so the row layout stays one DOM line per visual line.
  const rows: ReactNode[][] = [[]];
  let key = 0;
  for (const node of nodes) {
    if (typeof node === 'object' && node !== null && 'props' in node) {
      const props = (node as { props: { className?: string; children?: unknown } }).props;
      const text = String(props.children ?? '');
      const className = props.className;
      const pieces = text.split('\n');
      pieces.forEach((piece, i) => {
        if (piece.length > 0) {
          if (className) {
            rows[rows.length - 1].push(
              <span key={`s-${key++}`} className={className}>
                {piece}
              </span>,
            );
          } else {
            rows[rows.length - 1].push(piece);
          }
        }
        if (i < pieces.length - 1) rows.push([]);
      });
    } else {
      rows[rows.length - 1].push(node);
    }
  }
  return rows;
}

interface DiffLineProps {
  kind: 'context' | 'removed' | 'added';
  lineNumber: number | null;
  children: ReactNode;
}

function DiffLine({ kind, lineNumber, children }: DiffLineProps): ReactNode {
  const sigil = kind === 'removed' ? '-' : kind === 'added' ? '+' : ' ';
  return (
    <div className={`cobweb-diff-line cobweb-diff-line-${kind}`}>
      <span className="cobweb-diff-gutter">{lineNumber ?? ''}</span>
      <span className="cobweb-diff-sigil">{sigil}</span>
      <span className="cobweb-diff-content">
        {children}
        {/* Empty-line preserve: zero-width space so the row keeps its height. */}
        {'\u200b'}
      </span>
    </div>
  );
}

// ----- Failure notice + actions ---------------------------------------------

interface NoLongerAppliesNoticeProps {
  message: string;
  respondMessage: string;
  onRespondWith: (s: string) => void;
}

function NoLongerAppliesNotice({
  message,
  respondMessage,
  onRespondWith,
}: NoLongerAppliesNoticeProps): ReactNode {
  return (
    <div className="cobweb-approval-notice">
      <p>{message}</p>
      <button
        type="button"
        className="cobweb-approval-button cobweb-approval-button-secondary"
        onClick={() => onRespondWith(respondMessage)}
      >
        Tell the agent
      </button>
    </div>
  );
}

interface ApprovalActionsProps {
  approveDisabled?: boolean;
  destructiveApprove?: boolean;
  onApprove: () => void;
  onReject: () => void;
}

function ApprovalActions({
  approveDisabled = false,
  destructiveApprove = false,
  onApprove,
  onReject,
}: ApprovalActionsProps): ReactNode {
  const approveClass = destructiveApprove
    ? 'cobweb-approval-button cobweb-approval-button-approve-destructive'
    : 'cobweb-approval-button cobweb-approval-button-approve';
  return (
    <div className="cobweb-approval-actions">
      <button
        type="button"
        className={approveClass}
        onClick={onApprove}
        disabled={approveDisabled}
      >
        Approve
      </button>
      <button
        type="button"
        className="cobweb-approval-button cobweb-approval-button-reject"
        onClick={onReject}
      >
        Reject
      </button>
    </div>
  );
}
