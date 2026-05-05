// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileNavigator } from './FileNavigator';

type FakeEntry =
  | { kind: 'file'; content: string }
  | { kind: 'directory'; entries: Record<string, FakeEntry> };

function makeDirectoryHandle(name: string, entries: Record<string, FakeEntry>): unknown {
  const childHandles: [string, unknown][] = Object.entries(entries).map(([childName, entry]) => {
    if (entry.kind === 'file') {
      const fileHandle = {
        kind: 'file' as const,
        name: childName,
        getFile: vi
          .fn()
          .mockResolvedValue({ text: vi.fn().mockResolvedValue(entry.content) }),
      };
      return [childName, fileHandle];
    }
    return [childName, makeDirectoryHandle(childName, entry.entries)];
  });

  return {
    kind: 'directory' as const,
    name,
    entries: vi.fn().mockImplementation(
      () =>
        (async function* () {
          for (const entry of childHandles) yield entry;
        })(),
    ),
  };
}

describe('FileNavigator', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'showDirectoryPicker',
      vi.fn().mockResolvedValue(
        makeDirectoryHandle('project', {
          'main.py': { kind: 'file', content: 'print("hello")' },
          'boot.py': { kind: 'file', content: '' },
          lib: {
            kind: 'directory',
            entries: {
              'helper.py': { kind: 'file', content: 'def help(): pass' },
            },
          },
        }),
      ),
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

  it('renders the picked root expanded with its children', async () => {
    render(<FileNavigator onFileSelected={vi.fn()} />);
    await userEvent.click(screen.getByTitle('Open folder'));
    expect(await screen.findByText('project')).toBeInTheDocument();
    expect(screen.getByText('main.py')).toBeInTheDocument();
    expect(screen.getByText('boot.py')).toBeInTheDocument();
    expect(screen.getByText('lib')).toBeInTheDocument();
  });

  it('lists directories before files, alphabetically', async () => {
    render(<FileNavigator onFileSelected={vi.fn()} />);
    await userEvent.click(screen.getByTitle('Open folder'));
    await screen.findByText('project');
    const names = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => t !== '' && t !== 'Open Folder');
    expect(names).toEqual(['project', 'lib', 'boot.py', 'main.py']);
  });

  it('calls onFileSelected with content when a file is clicked', async () => {
    const onFileSelected = vi.fn();
    render(<FileNavigator onFileSelected={onFileSelected} />);
    await userEvent.click(screen.getByTitle('Open folder'));
    await userEvent.click(await screen.findByText('main.py'));
    expect(onFileSelected).toHaveBeenCalledWith('print("hello")');
  });

  it('lazily loads subfolder children when expanded', async () => {
    render(<FileNavigator onFileSelected={vi.fn()} />);
    await userEvent.click(screen.getByTitle('Open folder'));
    await screen.findByText('lib');
    expect(screen.queryByText('helper.py')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('lib'));
    expect(await screen.findByText('helper.py')).toBeInTheDocument();
  });

  it('collapses an expanded folder, hiding its children', async () => {
    render(<FileNavigator onFileSelected={vi.fn()} />);
    await userEvent.click(screen.getByTitle('Open folder'));
    await userEvent.click(await screen.findByText('lib'));
    await screen.findByText('helper.py');
    await userEvent.click(screen.getByText('lib'));
    expect(screen.queryByText('helper.py')).not.toBeInTheDocument();
  });

  it('reuses cached children when re-expanding a previously loaded folder', async () => {
    render(<FileNavigator onFileSelected={vi.fn()} />);
    await userEvent.click(screen.getByTitle('Open folder'));
    await userEvent.click(await screen.findByText('lib'));
    await screen.findByText('helper.py');
    await userEvent.click(screen.getByText('lib'));
    await userEvent.click(screen.getByText('lib'));
    expect(await screen.findByText('helper.py')).toBeInTheDocument();
  });
});
