// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { diffWords, type ChangeObject } from 'diff';
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
}

export function CobwebApproval({
  entry,
  approval,
  getEditorContent,
  revealEditorRange,
}: CobwebApprovalProps): ReactNode {
  switch (entry.name) {
    case 'edit_editor':
      return (
        <EditApprovalCard
          entry={entry}
          approval={approval}
          getEditorContent={getEditorContent}
          revealEditorRange={revealEditorRange}
        />
      );
    case 'write_editor':
      return <WriteApprovalCard entry={entry} approval={approval} />;
    default:
      return (
        <InlineApproval
          entry={entry}
          approve={approval.approve}
          reject={approval.reject}
          respondWith={approval.respondWith}
        />
      );
  }
}

// ----- EditApprovalCard ------------------------------------------------------

interface EditApprovalCardProps extends ApprovalSlotProps {
  getEditorContent: () => string;
  revealEditorRange: (from: number, to: number) => void;
}

function EditApprovalCard({
  entry,
  approval,
  getEditorContent,
  revealEditorRange,
}: EditApprovalCardProps): ReactNode {
  const args = entry.args as { old_string?: unknown; new_string?: unknown } | undefined;
  const oldString = typeof args?.old_string === 'string' ? args.old_string : '';
  const newString = typeof args?.new_string === 'string' ? args.new_string : '';

  // Diff against the live editor — the buffer the user sees right now is the
  // buffer the edit will apply to, so the renderer must read fresh on every
  // render rather than caching at construction time.
  const source = getEditorContent();
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
    didReveal.current = true;
    revealEditorRange(find.index, find.index + oldString.length);
  }, [find, oldString.length, revealEditorRange]);

  return (
    <div className="cobweb-approval-card" data-tool-name={entry.name}>
      <div className="cobweb-approval-header">
        <span className="cobweb-approval-title">Edit editor</span>
        <div className="cobweb-approval-header-actions">
          {find.kind === 'unique' && (
            <button
              type="button"
              className="cobweb-reveal-button"
              onClick={() =>
                revealEditorRange(find.index, find.index + oldString.length)
              }
              title="Scroll editor to this location"
            >
              Reveal
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
          message="old_string was not found in the current editor — the buffer may have changed since the agent proposed this edit."
          respondMessage="old_string not found in editor."
          onRespondWith={approval.respondWith}
        />
      ) : (
        <NoLongerAppliesNotice
          message={`old_string is now ambiguous — it appears ${find.count} times in the current editor.`}
          respondMessage={`old_string is ambiguous — appears ${find.count} times. Include more surrounding context.`}
          onRespondWith={approval.respondWith}
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

// ----- WriteApprovalCard ----------------------------------------------------

function WriteApprovalCard({ entry, approval }: ApprovalSlotProps): ReactNode {
  return (
    <div className="cobweb-approval-card" data-tool-name={entry.name}>
      <div className="cobweb-approval-header">
        <span className="cobweb-approval-title">Replace editor with new content</span>
        <span className="cobweb-approval-status">requires approval</span>
      </div>
      <ApprovalActions onApprove={approval.approve} onReject={approval.reject} />
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
        {'​'}
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
  onApprove: () => void;
  onReject: () => void;
}

function ApprovalActions({
  approveDisabled = false,
  onApprove,
  onReject,
}: ApprovalActionsProps): ReactNode {
  return (
    <div className="cobweb-approval-actions">
      <button
        type="button"
        className="cobweb-approval-button cobweb-approval-button-approve"
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
