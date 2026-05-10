// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { Tool, ToolDefinition } from '@mast-ai/core';

export interface FetchUrlArgs {
  url: string;
}

const MAX_BYTES = 30 * 1024;

interface RepoCandidate {
  kind: 'repo';
  url: string;
  owner: string;
  repo: string;
}

interface SingleCandidate {
  kind: 'single';
  url: string;
}

interface ImmediateResult {
  kind: 'immediate';
  message: string;
}

type Translation = RepoCandidate | SingleCandidate | ImmediateResult;

export function translateGitHubUrl(input: string): Translation {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { kind: 'single', url: input };
  }
  if (parsed.host !== 'github.com') {
    return { kind: 'single', url: input };
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return { kind: 'single', url: input };
  }
  const [owner, repo, kind, ...rest] = segments;
  if (kind === undefined) {
    return { kind: 'repo', owner, repo, url: rawReadmeUrl(owner, repo, 'main') };
  }
  if (kind === 'tree') {
    return {
      kind: 'immediate',
      message: 'Directory listing is not supported. Provide a specific file URL.',
    };
  }
  if (kind === 'blob') {
    if (rest.length < 2) return { kind: 'single', url: input };
    const [branch, ...path] = rest;
    const rawPath = path.map(encodeURIComponent).join('/');
    return {
      kind: 'single',
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rawPath}`,
    };
  }
  return { kind: 'single', url: input };
}

function rawReadmeUrl(owner: string, repo: string, branch: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function truncate(body: string, url: string): string {
  if (body.length <= MAX_BYTES) return body;
  return body.slice(0, MAX_BYTES) + `\n\n... [truncated, see full file at ${url}]\n`;
}

async function fetchOnce(url: string): Promise<string | { status: number } | { error: string }> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    return { error: describeError(err) };
  }
  if (!response.ok) return { status: response.status };
  return await response.text();
}

export class FetchUrlTool implements Tool<FetchUrlArgs, string> {
  definition(): ToolDefinition {
    return {
      name: 'fetch_url',
      description:
        'Fetches the contents of a URL and returns the body as text. Use this when the user provides a documentation URL, when board notes record a URL worth consulting, or when you need to read a known docs page (including raw GitHub files for MicroPython upstream docs). GitHub repo and blob URLs auto-translate to raw.githubusercontent.com. On failure, returns a descriptive error string (CORS-blocked, 404, network error) so you can decide on a fallback.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch (http or https).',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      scope: 'read',
      requiresApproval: false,
    };
  }

  async call(args: FetchUrlArgs): Promise<string> {
    const translation = translateGitHubUrl(args.url);
    if (translation.kind === 'immediate') return translation.message;

    if (translation.kind === 'repo') {
      const branches = ['main', 'master'];
      for (const branch of branches) {
        const url = rawReadmeUrl(translation.owner, translation.repo, branch);
        const result = await fetchOnce(url);
        if (typeof result === 'string') return truncate(result, url);
        if ('error' in result) {
          return `Could not fetch ${url}: ${result.error}. The host may have blocked cross-origin access. Try search_documentation, paste the relevant section into chat, or provide a github.com URL instead.`;
        }
        if (result.status === 404) continue;
        return `Fetched ${url} returned HTTP ${result.status}.`;
      }
      return `No README.md found on main or master branches of ${translation.owner}/${translation.repo}.`;
    }

    const url = translation.url;
    const result = await fetchOnce(url);
    if (typeof result === 'string') return truncate(result, url);
    if ('error' in result) {
      return `Could not fetch ${url}: ${result.error}. The host may have blocked cross-origin access. Try search_documentation, paste the relevant section into chat, or provide a github.com URL instead.`;
    }
    return `Fetched ${url} returned HTTP ${result.status}.`;
  }
}
