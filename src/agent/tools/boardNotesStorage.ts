// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export function boardNotesKey(machineName: string): string {
  return `cobweb:board-notes:${machineName}`;
}
