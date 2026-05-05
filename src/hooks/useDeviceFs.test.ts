// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { RunResult } from '../ReplInterface';
import type { ConnectionState } from './useReplConnection';

const { mockDeviceFs } = vi.hoisted(() => ({
  mockDeviceFs: {
    list: vi.fn(),
    stat: vi.fn(),
    readBytes: vi.fn(),
    readText: vi.fn(),
    writeBytes: vi.fn(),
    writeText: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    removeFile: vi.fn(),
    removeDir: vi.fn(),
  },
}));

vi.mock('../DeviceFs', async () => {
  const actual = await vi.importActual<typeof import('../DeviceFs')>('../DeviceFs');
  class MockDeviceFs {
    list = mockDeviceFs.list;
    stat = mockDeviceFs.stat;
    readBytes = mockDeviceFs.readBytes;
    readText = mockDeviceFs.readText;
    writeBytes = mockDeviceFs.writeBytes;
    writeText = mockDeviceFs.writeText;
    mkdir = mockDeviceFs.mkdir;
    rename = mockDeviceFs.rename;
    removeFile = mockDeviceFs.removeFile;
    removeDir = mockDeviceFs.removeDir;
  }
  return { ...actual, DeviceFs: MockDeviceFs };
});

import { useDeviceFs, type DeviceTreeNode, type DeviceTreeEntry } from './useDeviceFs';

function makeSendRaw() {
  return vi.fn(async (): Promise<RunResult> => ({ stdout: '', stderr: '' }));
}

function findChild(tree: DeviceTreeNode | null, path: string): DeviceTreeEntry | undefined {
  if (!tree) return undefined;
  for (const c of tree.children) {
    if (c.path === path) return c;
    if (c.isDir) {
      const found = findChild(c, path);
      if (found) return found;
    }
  }
  return undefined;
}

// Auto-expand of `/` is async; waiting for `expanded === true` ensures
// subsequent mutations see the root as expanded.
async function waitForConnect(result: { current: { tree: DeviceTreeNode | null } }) {
  await waitFor(() => expect(result.current.tree?.expanded).toBe(true));
}

beforeEach(() => {
  Object.values(mockDeviceFs).forEach((m) => m.mockReset());
  mockDeviceFs.list.mockResolvedValue([]);
  mockDeviceFs.mkdir.mockResolvedValue(undefined);
  mockDeviceFs.removeFile.mockResolvedValue(undefined);
  mockDeviceFs.removeDir.mockResolvedValue(undefined);
  mockDeviceFs.rename.mockResolvedValue(undefined);
  mockDeviceFs.writeText.mockResolvedValue(undefined);
  mockDeviceFs.writeBytes.mockResolvedValue(undefined);
  mockDeviceFs.readText.mockResolvedValue('');
  mockDeviceFs.readBytes.mockResolvedValue(new Uint8Array());
});

describe('useDeviceFs lifecycle', () => {
  it('starts with no tree when disconnected', () => {
    const sendRaw = makeSendRaw();
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'disconnected', sendRaw }),
    );
    expect(result.current.tree).toBeNull();
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.busy).toBe(false);
    expect(result.current.lastError).toBeNull();
  });

  it('builds a root tree and auto-expands it on connect', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([
      { name: 'main.py', isDir: false },
      { name: 'lib', isDir: true },
    ]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );

    await waitFor(() => {
      expect(result.current.tree).not.toBeNull();
      expect(result.current.tree!.expanded).toBe(true);
    });
    expect(mockDeviceFs.list).toHaveBeenCalledWith('/');
    expect(result.current.tree!.children).toHaveLength(2);
    // Directories sort first.
    expect(result.current.tree!.children[0].name).toBe('lib');
    expect(result.current.tree!.children[1].name).toBe('main.py');
  });

  it('discards the tree on disconnect', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result, rerender } = renderHook(
      ({ state }) => useDeviceFs({ connectionState: state, sendRaw }),
      { initialProps: { state: 'connected' as ConnectionState } },
    );
    await waitForConnect(result);

    rerender({ state: 'disconnected' });
    await waitFor(() => expect(result.current.tree).toBeNull());
    expect(result.current.isAvailable).toBe(false);
  });
});

describe('useDeviceFs.expand / collapse / refresh', () => {
  it('expand populates children of a directory', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'lib', isDir: true }]); // root
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitFor(() => expect(result.current.tree?.children).toHaveLength(1));

    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'foo.py', isDir: false }]); // /lib
    await act(() => result.current.expand('/lib'));

    const lib = findChild(result.current.tree, '/lib');
    expect(lib).toBeDefined();
    expect(lib!.isDir).toBe(true);
    expect((lib as DeviceTreeNode).expanded).toBe(true);
    expect((lib as DeviceTreeNode).children).toHaveLength(1);
    expect((lib as DeviceTreeNode).children[0].path).toBe('/lib/foo.py');
  });

  it('collapse sets expanded=false but keeps children intact', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list
      .mockResolvedValueOnce([{ name: 'lib', isDir: true }])
      .mockResolvedValueOnce([{ name: 'foo.py', isDir: false }]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitFor(() => expect(result.current.tree?.children).toHaveLength(1));
    await act(() => result.current.expand('/lib'));

    act(() => result.current.collapse('/lib'));
    const lib = findChild(result.current.tree, '/lib') as DeviceTreeNode;
    expect(lib.expanded).toBe(false);
    expect(lib.children).toHaveLength(1);
  });

  it('refresh re-lists a directory and merges with existing children', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'a.py', isDir: false }]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitFor(() => expect(result.current.tree?.children).toHaveLength(1));

    mockDeviceFs.list.mockResolvedValueOnce([
      { name: 'a.py', isDir: false },
      { name: 'b.py', isDir: false },
    ]);
    await act(() => result.current.refresh('/'));
    expect(result.current.tree!.children).toHaveLength(2);
  });

  it('refresh preserves expansion state of surviving subdirectories', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'lib', isDir: true }]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitFor(() => expect(result.current.tree?.children).toHaveLength(1));

    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'foo.py', isDir: false }]);
    await act(() => result.current.expand('/lib'));
    expect((findChild(result.current.tree, '/lib') as DeviceTreeNode).expanded).toBe(true);

    // Refresh root with /lib still present plus a new sibling.
    mockDeviceFs.list.mockResolvedValueOnce([
      { name: 'lib', isDir: true },
      { name: 'main.py', isDir: false },
    ]);
    await act(() => result.current.refresh('/'));

    const lib = findChild(result.current.tree, '/lib') as DeviceTreeNode;
    expect(lib.expanded).toBe(true);
    expect(lib.children).toHaveLength(1);
    expect(lib.children[0].path).toBe('/lib/foo.py');
  });

  it('refresh prunes directories that no longer exist', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'gone', isDir: true }]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitFor(() => expect(result.current.tree?.children).toHaveLength(1));

    mockDeviceFs.list.mockResolvedValueOnce([]);
    await act(() => result.current.refresh('/'));
    expect(result.current.tree!.children).toHaveLength(0);
  });

  it('refreshAll re-lists every currently-expanded directory', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list
      .mockResolvedValueOnce([{ name: 'lib', isDir: true }])
      .mockResolvedValueOnce([]); // expand /lib
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitFor(() => expect(result.current.tree?.children).toHaveLength(1));
    await act(() => result.current.expand('/lib'));

    mockDeviceFs.list.mockClear();
    mockDeviceFs.list
      .mockResolvedValueOnce([{ name: 'lib', isDir: true }])
      .mockResolvedValueOnce([]);
    await act(() => result.current.refreshAll());

    expect(mockDeviceFs.list).toHaveBeenCalledTimes(2);
    expect(mockDeviceFs.list).toHaveBeenNthCalledWith(1, '/');
    expect(mockDeviceFs.list).toHaveBeenNthCalledWith(2, '/lib');
  });
});

describe('useDeviceFs busy state', () => {
  it('is true while a list call is in flight and false after it resolves', async () => {
    const sendRaw = makeSendRaw();
    let resolveList: (v: { name: string; isDir: boolean }[]) => void = () => {};
    mockDeviceFs.list.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveList = r;
        }),
    );
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );

    await waitFor(() => expect(result.current.busy).toBe(true));

    await act(async () => {
      resolveList([]);
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
  });
});

describe('useDeviceFs mutation refresh', () => {
  it('mkdir refreshes dirname when expanded', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'newdir', isDir: true }]);
    await act(() => result.current.mkdir('/newdir'));

    expect(mockDeviceFs.mkdir).toHaveBeenCalledWith('/newdir');
    expect(result.current.tree!.children).toHaveLength(1);
    expect(result.current.tree!.children[0].path).toBe('/newdir');
  });

  it('skips refresh when dirname is not expanded', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    act(() => result.current.collapse('/'));
    mockDeviceFs.list.mockClear();
    await act(() => result.current.mkdir('/x'));

    expect(mockDeviceFs.mkdir).toHaveBeenCalledWith('/x');
    expect(mockDeviceFs.list).not.toHaveBeenCalled();
  });

  it('skips refresh when dirname is not in the tree at all', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    mockDeviceFs.list.mockClear();
    await act(() => result.current.mkdir('/unknown/sub'));

    expect(mockDeviceFs.mkdir).toHaveBeenCalledWith('/unknown/sub');
    expect(mockDeviceFs.list).not.toHaveBeenCalled();
  });

  it('writeText refreshes dirname', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'main.py', isDir: false }]);
    await act(() => result.current.writeText('/main.py', 'print(1)'));

    expect(mockDeviceFs.writeText).toHaveBeenCalledWith('/main.py', 'print(1)');
    expect(result.current.tree!.children).toHaveLength(1);
  });

  it('removeFile refreshes dirname', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'gone.py', isDir: false }]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitFor(() => expect(result.current.tree?.children).toHaveLength(1));

    mockDeviceFs.list.mockResolvedValueOnce([]);
    await act(() => result.current.removeFile('/gone.py'));
    expect(mockDeviceFs.removeFile).toHaveBeenCalledWith('/gone.py');
    expect(result.current.tree!.children).toHaveLength(0);
  });

  it('rename refreshes both ends when dirnames differ', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([
      { name: 'a', isDir: true },
      { name: 'b', isDir: true },
    ]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitFor(() => expect(result.current.tree?.children).toHaveLength(2));

    mockDeviceFs.list
      .mockResolvedValueOnce([{ name: 'foo.py', isDir: false }]) // expand /a
      .mockResolvedValueOnce([]); // expand /b
    await act(() => result.current.expand('/a'));
    await act(() => result.current.expand('/b'));

    mockDeviceFs.list.mockClear();
    mockDeviceFs.list
      .mockResolvedValueOnce([]) // refresh /a
      .mockResolvedValueOnce([{ name: 'foo.py', isDir: false }]); // refresh /b

    await act(() => result.current.rename('/a/foo.py', '/b/foo.py'));
    expect(mockDeviceFs.rename).toHaveBeenCalledWith('/a/foo.py', '/b/foo.py');
    expect(mockDeviceFs.list).toHaveBeenCalledTimes(2);
    expect(mockDeviceFs.list).toHaveBeenCalledWith('/a');
    expect(mockDeviceFs.list).toHaveBeenCalledWith('/b');
  });

  it('rename refreshes once when dirnames match', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'a.py', isDir: false }]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitFor(() => expect(result.current.tree?.children).toHaveLength(1));

    mockDeviceFs.list.mockClear();
    mockDeviceFs.list.mockResolvedValueOnce([{ name: 'b.py', isDir: false }]);

    await act(() => result.current.rename('/a.py', '/b.py'));
    expect(mockDeviceFs.list).toHaveBeenCalledTimes(1);
    expect(mockDeviceFs.list).toHaveBeenCalledWith('/');
  });

  it('refresh failure after a successful mutation is best-effort (does not throw)', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    mockDeviceFs.list.mockRejectedValueOnce(new Error('refresh failed'));
    await expect(act(() => result.current.mkdir('/x'))).resolves.toBeUndefined();
    expect(result.current.lastError?.message).toBe('refresh failed');
  });
});

describe('useDeviceFs.removeDir recursive', () => {
  it('walks host-side: list → recurse subdirs → removeFile files → removeDir bottom-up', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]); // initial root
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    mockDeviceFs.list.mockClear();
    mockDeviceFs.list
      .mockResolvedValueOnce([
        { name: 'foo.py', isDir: false },
        { name: 'sub', isDir: true },
      ]) // list /lib
      .mockResolvedValueOnce([{ name: 'bar.py', isDir: false }]) // list /lib/sub
      .mockResolvedValueOnce([]); // refresh root

    await act(() => result.current.removeDir('/lib', { recursive: true }));

    expect(mockDeviceFs.removeFile).toHaveBeenCalledWith('/lib/foo.py');
    expect(mockDeviceFs.removeFile).toHaveBeenCalledWith('/lib/sub/bar.py');
    expect(mockDeviceFs.removeDir).toHaveBeenCalledTimes(2);
    expect(mockDeviceFs.removeDir).toHaveBeenNthCalledWith(1, '/lib/sub');
    expect(mockDeviceFs.removeDir).toHaveBeenNthCalledWith(2, '/lib');
  });

  it('non-recursive removeDir calls device removeDir directly without walking', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    await act(() => result.current.removeDir('/lib'));

    expect(mockDeviceFs.removeDir).toHaveBeenCalledWith('/lib');
    // Non-recursive must not walk subdirectory contents.
    expect(mockDeviceFs.removeFile).not.toHaveBeenCalled();
  });
});

describe('useDeviceFs error reporting', () => {
  it('sets lastError on mutation failure and re-throws', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    const boom = new Error('boom');
    mockDeviceFs.mkdir.mockRejectedValueOnce(boom);
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mkdir('/x');
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBe(boom);
    await waitFor(() => expect(result.current.lastError).toBe(boom));
  });

  it('clears lastError on the next successful op', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    mockDeviceFs.mkdir.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      try {
        await result.current.mkdir('/x');
      } catch {
        // expected
      }
    });
    await waitFor(() => expect(result.current.lastError).not.toBeNull());

    mockDeviceFs.mkdir.mockResolvedValueOnce(undefined);
    await act(() => result.current.mkdir('/y'));
    await waitFor(() => expect(result.current.lastError).toBeNull());
  });

  it('mutations throw when not connected', async () => {
    const sendRaw = makeSendRaw();
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'disconnected', sendRaw }),
    );
    await expect(result.current.mkdir('/x')).rejects.toThrow(/not connected/i);
    await expect(result.current.writeText('/x', 'y')).rejects.toThrow(/not connected/i);
    await expect(result.current.readText('/x')).rejects.toThrow(/not connected/i);
  });
});

describe('useDeviceFs read pass-through', () => {
  it('readText delegates to DeviceFs.readText', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    mockDeviceFs.readText.mockResolvedValueOnce('hello');
    let text: string | undefined;
    await act(async () => {
      text = await result.current.readText('/foo.txt');
    });
    expect(text).toBe('hello');
    expect(mockDeviceFs.readText).toHaveBeenCalledWith('/foo.txt');
  });

  it('readBytes delegates to DeviceFs.readBytes', async () => {
    const sendRaw = makeSendRaw();
    mockDeviceFs.list.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useDeviceFs({ connectionState: 'connected', sendRaw }),
    );
    await waitForConnect(result);

    const expected = new Uint8Array([1, 2, 3]);
    mockDeviceFs.readBytes.mockResolvedValueOnce(expected);
    let bytes: Uint8Array | undefined;
    await act(async () => {
      bytes = await result.current.readBytes('/foo.bin');
    });
    expect(bytes).toBe(expected);
  });
});
