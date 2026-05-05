// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export function DeviceFileNavigator() {
  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="flex items-center px-2 py-1 border-b border-border">
        <span className="px-2 py-1 text-sm font-medium">Device Files</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 text-sm text-muted-foreground">
        Connect a device to browse its files.
      </div>
    </div>
  );
}
