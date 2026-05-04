// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { escapePythonStr } from './lib/devicePath';
import type { RunResult } from './ReplInterface';

export interface DeviceDirEntry {
  name: string;
  isDir: boolean;
}

export interface DeviceStat {
  isDir: boolean;
  size: number;
}

/**
 * Thrown when the device-side helper reported an error (an `ERR:` line in
 * stdout). The message carries the device's exception text so the UI can
 * surface it to the user without further translation.
 */
export class DeviceFsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeviceFsError';
  }
}

const ERR_PREFIX = 'ERR:';

/**
 * Typed device-filesystem API. Each operation builds a small MicroPython
 * snippet, runs it via the injected `runRaw`, and parses the response.
 *
 * Errors propagate as:
 *   - `DeviceFsError` for device-reported errors (`ERR:` lines).
 *   - The original `runRaw` rejection (e.g. `ReplDisconnectedError`) for
 *     connection loss; these are re-thrown unchanged.
 *   - `Error` for protocol violations (unparseable output, oversized file).
 */
export class DeviceFs {
  /** Maximum file size accepted by `readBytes`. */
  static readonly MAX_READ_BYTES = 256 * 1024;
  /** Maximum payload size accepted by `writeBytes`, enforced host-side. */
  static readonly MAX_WRITE_BYTES = 256 * 1024;

  constructor(private runRaw: (code: string) => Promise<RunResult>) {}

  async list(path: string): Promise<DeviceDirEntry[]> {
    const p = escapePythonStr(path);
    const code = [
      'try:',
      '    import os, json',
      `    _p = '${p}'`,
      "    _base = _p if _p == '/' else _p + '/'",
      "    _r = [{'name': n, 'isDir': (os.stat(_base + n)[0] & 0x4000) != 0} for n in os.listdir(_p)]",
      '    print(json.dumps(_r))',
      'except Exception as e:',
      "    print('ERR:' + str(e))",
    ].join('\n');
    const line = await this.runAndExtract(code);
    return parseJson<DeviceDirEntry[]>(line);
  }

  async stat(path: string): Promise<DeviceStat> {
    const p = escapePythonStr(path);
    const code = [
      'try:',
      '    import os, json',
      `    _s = os.stat('${p}')`,
      "    print(json.dumps({'isDir': (_s[0] & 0x4000) != 0, 'size': _s[6]}))",
      'except Exception as e:',
      "    print('ERR:' + str(e))",
    ].join('\n');
    const line = await this.runAndExtract(code);
    return parseJson<DeviceStat>(line);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const p = escapePythonStr(path);
    const code = [
      'try:',
      '    import os, binascii',
      `    _s = os.stat('${p}')`,
      `    if _s[6] > ${DeviceFs.MAX_READ_BYTES}:`,
      "        print('ERR:File too large to open')",
      '    else:',
      `        _f = open('${p}', 'rb')`,
      '        print(binascii.b2a_base64(_f.read()).decode().strip())',
      '        _f.close()',
      'except Exception as e:',
      "    print('ERR:' + str(e))",
    ].join('\n');
    const result = await this.runRaw(code);
    assertNoStderr(result);
    // Empty stdout means an empty file: b2a_base64(b'').decode().strip() is ''.
    const line = firstNonEmptyLine(result.stdout) ?? '';
    if (line.startsWith(ERR_PREFIX)) {
      throw new DeviceFsError(line.slice(ERR_PREFIX.length));
    }
    return decodeBase64(line);
  }

  async readText(path: string): Promise<string> {
    const bytes = await this.readBytes(path);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (err) {
      throw new Error('File is not valid UTF-8', { cause: err });
    }
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength > DeviceFs.MAX_WRITE_BYTES) {
      throw new Error(
        `File too large to write (${bytes.byteLength} bytes; limit ${DeviceFs.MAX_WRITE_BYTES})`,
      );
    }
    const p = escapePythonStr(path);
    const b64 = encodeBase64(bytes);
    const code = [
      'try:',
      '    import binascii',
      `    _f = open('${p}', 'wb')`,
      `    _f.write(binascii.a2b_base64(b'${b64}'))`,
      '    _f.close()',
      'except Exception as e:',
      "    print('ERR:' + str(e))",
    ].join('\n');
    await this.runAndExpectAck(code);
  }

  async writeText(path: string, text: string): Promise<void> {
    const bytes = new TextEncoder().encode(text);
    return this.writeBytes(path, bytes);
  }

  async mkdir(path: string): Promise<void> {
    await this.runAndExpectAck(buildMutationSnippet('os', `os.mkdir('${escapePythonStr(path)}')`));
  }

  async rename(from: string, to: string): Promise<void> {
    const f = escapePythonStr(from);
    const t = escapePythonStr(to);
    await this.runAndExpectAck(buildMutationSnippet('os', `os.rename('${f}', '${t}')`));
  }

  async removeFile(path: string): Promise<void> {
    await this.runAndExpectAck(buildMutationSnippet('os', `os.remove('${escapePythonStr(path)}')`));
  }

  async removeDir(path: string): Promise<void> {
    await this.runAndExpectAck(buildMutationSnippet('os', `os.rmdir('${escapePythonStr(path)}')`));
  }

  /** Run `code` and return the first non-empty stdout line (or throw). */
  private async runAndExtract(code: string): Promise<string> {
    const result = await this.runRaw(code);
    assertNoStderr(result);
    const line = firstNonEmptyLine(result.stdout);
    if (line === null) {
      throw new Error('DeviceFs: device returned no output');
    }
    if (line.startsWith(ERR_PREFIX)) {
      throw new DeviceFsError(line.slice(ERR_PREFIX.length));
    }
    return line;
  }

  /** Run `code` and require empty stdout; surface `ERR:` lines as DeviceFsError. */
  private async runAndExpectAck(code: string): Promise<void> {
    const result = await this.runRaw(code);
    assertNoStderr(result);
    const line = firstNonEmptyLine(result.stdout);
    if (line === null) return;
    if (line.startsWith(ERR_PREFIX)) {
      throw new DeviceFsError(line.slice(ERR_PREFIX.length));
    }
    throw new Error(`DeviceFs: unexpected output: ${line}`);
  }
}

function buildMutationSnippet(modules: string, statement: string): string {
  return [
    'try:',
    `    import ${modules}`,
    `    ${statement}`,
    'except Exception as e:',
    "    print('ERR:' + str(e))",
  ].join('\n');
}

function firstNonEmptyLine(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return null;
}

function assertNoStderr(result: RunResult): void {
  const stderr = result.stderr.trim();
  if (stderr !== '') {
    throw new Error(`DeviceFs: device reported stderr: ${stderr}`);
  }
}

function parseJson<T>(line: string): T {
  try {
    return JSON.parse(line) as T;
  } catch (err) {
    throw new Error(`DeviceFs: failed to parse JSON response: ${line}`, { cause: err });
  }
}

function decodeBase64(line: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(line);
  } catch (err) {
    throw new Error('DeviceFs: failed to decode base64 response', { cause: err });
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
