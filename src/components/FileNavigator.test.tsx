// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileNavigator } from './FileNavigator';

function makeDirectoryHandle(files: Record<string, string>) {
  const entries = Object.entries(files).map(([name, content]) => {
    const handle = {
      kind: 'file' as const,
      getFile: vi.fn().mockResolvedValue({ text: vi.fn().mockResolvedValue(content) }),
    };
    return [name, handle] as const;
  });

  return {
    entries: vi.fn().mockReturnValue(
      (async function* () {
        for (const entry of entries) yield entry;
      })(),
    ),
  };
}

describe('FileNavigator', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'showDirectoryPicker',
      vi.fn().mockResolvedValue(makeDirectoryHandle({ 'main.py': 'print("hello")', 'boot.py': '' })),
    );
  });

  it('renders the Open Folder button', () => {
    render(<FileNavigator onFileSelected={vi.fn()} />);
    expect(screen.getByTitle('Open folder')).toBeInTheDocument();
  });

  it('calls showDirectoryPicker when Open Folder is clicked', async () => {
    render(<FileNavigator onFileSelected={vi.fn()} />);
    await userEvent.click(screen.getByTitle('Open folder'));
    expect(window.showDirectoryPicker).toHaveBeenCalledOnce();
  });

  it('lists files from the directory after opening', async () => {
    render(<FileNavigator onFileSelected={vi.fn()} />);
    await userEvent.click(screen.getByTitle('Open folder'));
    expect(await screen.findByText('main.py')).toBeInTheDocument();
    expect(screen.getByText('boot.py')).toBeInTheDocument();
  });

  it('calls onFileSelected with content when a file is clicked', async () => {
    const onFileSelected = vi.fn();
    render(<FileNavigator onFileSelected={onFileSelected} />);
    await userEvent.click(screen.getByTitle('Open folder'));
    await userEvent.click(await screen.findByText('main.py'));
    expect(onFileSelected).toHaveBeenCalledWith('print("hello")');
  });
});
