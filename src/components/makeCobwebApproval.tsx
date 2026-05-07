// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { RenderApproval } from '@mast-ai/react-ui';
import { CobwebApproval } from './CobwebApproval';

export function makeCobwebApproval(
  getEditorContent: () => string,
  revealEditorRange: (from: number, to: number) => void,
  readDeviceFile: (path: string) => Promise<string | null>,
): RenderApproval {
  return (entry, approval) => (
    <CobwebApproval
      entry={entry}
      approval={approval}
      getEditorContent={getEditorContent}
      revealEditorRange={revealEditorRange}
      readDeviceFile={readDeviceFile}
    />
  );
}
