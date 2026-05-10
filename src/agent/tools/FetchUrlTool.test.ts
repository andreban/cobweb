// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FetchUrlTool, translateGitHubUrl } from './FetchUrlTool';

function ok(body: string): Response {
  return new Response(body, { status: 200 });
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

function serverError(): Response {
  return new Response('boom', { status: 500 });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('translateGitHubUrl', () => {
  it('returns repo candidate for https://github.com/owner/repo', () => {
    expect(translateGitHubUrl('https://github.com/pimoroni/presto')).toEqual({
      kind: 'repo',
      owner: 'pimoroni',
      repo: 'presto',
      url: 'https://raw.githubusercontent.com/pimoroni/presto/main/README.md',
    });
  });

  it('translates blob URLs to raw.githubusercontent.com', () => {
    expect(
      translateGitHubUrl(
        'https://github.com/micropython/micropython/blob/master/docs/library/machine.rst',
      ),
    ).toEqual({
      kind: 'single',
      url: 'https://raw.githubusercontent.com/micropython/micropython/master/docs/library/machine.rst',
    });
  });

  it('translates blob URLs with nested paths', () => {
    expect(
      translateGitHubUrl(
        'https://github.com/owner/repo/blob/main/a/b/c.md',
      ),
    ).toEqual({
      kind: 'single',
      url: 'https://raw.githubusercontent.com/owner/repo/main/a/b/c.md',
    });
  });

  it('returns immediate "directory listing not supported" for tree URLs', () => {
    expect(
      translateGitHubUrl('https://github.com/micropython/micropython/tree/master/docs'),
    ).toEqual({
      kind: 'immediate',
      message: 'Directory listing is not supported. Provide a specific file URL.',
    });
  });

  it('passes non-github URLs through unchanged', () => {
    expect(translateGitHubUrl('https://example.com/foo.html')).toEqual({
      kind: 'single',
      url: 'https://example.com/foo.html',
    });
  });

  it('passes invalid URLs through unchanged', () => {
    expect(translateGitHubUrl('not a url')).toEqual({
      kind: 'single',
      url: 'not a url',
    });
  });
});

describe('FetchUrlTool', () => {
  it('definition has correct name, scope, and no approval', () => {
    const def = new FetchUrlTool().definition();
    expect(def.name).toBe('fetch_url');
    expect(def.scope).toBe('read');
    expect(def.requiresApproval).toBe(false);
    expect(def.parameters.required).toEqual(['url']);
  });

  it('returns body for a successful plain URL fetch', async () => {
    fetchMock.mockResolvedValueOnce(ok('hello world'));
    const tool = new FetchUrlTool();
    await expect(tool.call({ url: 'https://example.com/page.txt' })).resolves.toBe(
      'hello world',
    );
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/page.txt');
  });

  it('translates GitHub repo URL and returns README from main', async () => {
    fetchMock.mockResolvedValueOnce(ok('# Presto README'));
    const tool = new FetchUrlTool();
    await expect(tool.call({ url: 'https://github.com/pimoroni/presto' })).resolves.toBe(
      '# Presto README',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/pimoroni/presto/main/README.md',
    );
  });

  it('falls back to master when main returns 404', async () => {
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(ok('legacy README'));
    const tool = new FetchUrlTool();
    await expect(tool.call({ url: 'https://github.com/owner/repo' })).resolves.toBe(
      'legacy README',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://raw.githubusercontent.com/owner/repo/main/README.md',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://raw.githubusercontent.com/owner/repo/master/README.md',
    );
  });

  it('returns "No README.md found" when both branches 404', async () => {
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(notFound());
    const tool = new FetchUrlTool();
    await expect(tool.call({ url: 'https://github.com/owner/repo' })).resolves.toBe(
      'No README.md found on main or master branches of owner/repo.',
    );
  });

  it('translates GitHub blob URL and fetches via raw host', async () => {
    fetchMock.mockResolvedValueOnce(ok('rst body'));
    const tool = new FetchUrlTool();
    await expect(
      tool.call({
        url: 'https://github.com/micropython/micropython/blob/master/docs/library/machine.rst',
      }),
    ).resolves.toBe('rst body');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/micropython/micropython/master/docs/library/machine.rst',
    );
  });

  it('returns "Directory listing is not supported" for tree URLs without fetching', async () => {
    const tool = new FetchUrlTool();
    await expect(
      tool.call({
        url: 'https://github.com/micropython/micropython/tree/master/docs',
      }),
    ).resolves.toBe('Directory listing is not supported. Provide a specific file URL.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns descriptive CORS error string when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const tool = new FetchUrlTool();
    await expect(tool.call({ url: 'https://blocked.example.com/page' })).resolves.toBe(
      'Could not fetch https://blocked.example.com/page: Failed to fetch. The host may have blocked cross-origin access. Try search_documentation, paste the relevant section into chat, or provide a github.com URL instead.',
    );
  });

  it('returns "HTTP 500" string for non-OK responses on plain URLs', async () => {
    fetchMock.mockResolvedValueOnce(serverError());
    const tool = new FetchUrlTool();
    await expect(tool.call({ url: 'https://example.com/bad' })).resolves.toBe(
      'Fetched https://example.com/bad returned HTTP 500.',
    );
  });

  it('returns "HTTP 500" string for non-OK responses on GitHub repo branches without retrying', async () => {
    fetchMock.mockResolvedValueOnce(serverError());
    const tool = new FetchUrlTool();
    await expect(tool.call({ url: 'https://github.com/owner/repo' })).resolves.toBe(
      'Fetched https://raw.githubusercontent.com/owner/repo/main/README.md returned HTTP 500.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('truncates bodies over 30 KB and adds the marker', async () => {
    const big = 'x'.repeat(30 * 1024 + 500);
    fetchMock.mockResolvedValueOnce(ok(big));
    const tool = new FetchUrlTool();
    const url = 'https://example.com/big.txt';
    const result = await tool.call({ url });
    expect(result.startsWith('x'.repeat(30 * 1024))).toBe(true);
    expect(result.endsWith(`... [truncated, see full file at ${url}]\n`)).toBe(true);
    expect(result.length).toBeLessThan(big.length);
  });

  it('does not truncate bodies at or under the 30 KB cap', async () => {
    const exact = 'y'.repeat(30 * 1024);
    fetchMock.mockResolvedValueOnce(ok(exact));
    const tool = new FetchUrlTool();
    await expect(tool.call({ url: 'https://example.com/exact' })).resolves.toBe(exact);
  });
});
