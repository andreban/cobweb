// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { FolderOpen } from 'lucide-react';
import { useState } from 'react';

interface FileNavigatorProps {
  onFileSelected: (content: string) => void;
}

export function FileNavigator({ onFileSelected }: FileNavigatorProps) {
  const [files, setFiles] = useState<Map<string, FileSystemFileHandle>>(new Map());

  const openDirectory = async () => {
    const dirHandle = await window.showDirectoryPicker();
    const newFiles = new Map<string, FileSystemFileHandle>();
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file') {
        newFiles.set(name, handle as FileSystemFileHandle);
      }
    }
    setFiles(newFiles);
  };

  const openFile = async (handle: FileSystemFileHandle) => {
    const file = await handle.getFile();
    const content = await file.text();
    onFileSelected(content);
  };

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        <button
          onClick={openDirectory}
          title="Open folder"
          className="flex items-center gap-1.5 px-2 py-1 rounded text-sm hover:bg-accent transition-colors w-full"
        >
          <FolderOpen size={14} />
          Open Folder
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {[...files.entries()].map(([name, handle]) => (
          <li key={name}>
            <button
              onClick={() => openFile(handle)}
              className="w-full text-left px-3 py-1 text-sm hover:bg-accent transition-colors truncate"
            >
              {name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
