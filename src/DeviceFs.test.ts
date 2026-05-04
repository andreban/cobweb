// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest';
import { DeviceFs, DeviceFsError } from './DeviceFs';
import type { RunResult } from './ReplInterface';

function ok(stdout = ''): RunResult {
  return { stdout, stderr: '' };
}

function makeRunRaw(result: RunResult | (() => RunResult | Promise<RunResult>)) {
  const fn = vi.fn(async (): Promise<RunResult> => {
    return typeof result === 'function' ? await result() : result;
  });
  return fn;
}

describe('DeviceFs.list', () => {
  it('parses a directory listing', async () => {
    const runRaw = makeRunRaw(ok('[{"name": "main.py", "isDir": false}, {"name": "lib", "isDir": true}]\n'));
    const fs = new DeviceFs(runRaw);
    const entries = await fs.list('/');
    expect(entries).toEqual([
      { name: 'main.py', isDir: false },
      { name: 'lib', isDir: true },
    ]);
  });

  it('embeds the path as a Python string literal', async () => {
    const runRaw = makeRunRaw(ok('[]'));
    const fs = new DeviceFs(runRaw);
    await fs.list('/lib');
    expect(runRaw).toHaveBeenCalledOnce();
    const code = runRaw.mock.calls[0][0];
    expect(code).toContain("_p = '/lib'");
    expect(code).toContain('os.listdir(_p)');
    expect(code).toContain('json.dumps(_r)');
  });

  it('escapes single quotes and backslashes in the path', async () => {
    const runRaw = makeRunRaw(ok('[]'));
    const fs = new DeviceFs(runRaw);
    await fs.list("/o'brien\\dir");
    const code = runRaw.mock.calls[0][0];
    expect(code).toContain("_p = '/o\\'brien\\\\dir'");
  });

  it('returns an empty array for empty directories', async () => {
    const runRaw = makeRunRaw(ok('[]\n'));
    const fs = new DeviceFs(runRaw);
    expect(await fs.list('/empty')).toEqual([]);
  });

  it('throws DeviceFsError on an ERR: line', async () => {
    const runRaw = makeRunRaw(ok('ERR:[Errno 2] ENOENT\n'));
    const fs = new DeviceFs(runRaw);
    await expect(fs.list('/missing')).rejects.toBeInstanceOf(DeviceFsError);
    await expect(fs.list('/missing')).rejects.toThrow('[Errno 2] ENOENT');
  });

  it('throws Error when stdout is empty', async () => {
    const runRaw = makeRunRaw(ok(''));
    const fs = new DeviceFs(runRaw);
    await expect(fs.list('/')).rejects.toThrow(/no output/);
  });

  it('throws Error when JSON is invalid', async () => {
    const runRaw = makeRunRaw(ok('not json\n'));
    const fs = new DeviceFs(runRaw);
    const promise = fs.list('/');
    await expect(promise).rejects.not.toBeInstanceOf(DeviceFsError);
    await expect(promise).rejects.toThrow(/parse JSON/);
  });

  it('throws Error when stderr is non-empty', async () => {
    const runRaw = makeRunRaw({ stdout: '', stderr: 'SyntaxError: invalid syntax\n' });
    const fs = new DeviceFs(runRaw);
    await expect(fs.list('/')).rejects.toThrow(/stderr/);
  });
});

describe('DeviceFs.stat', () => {
  it('parses a stat result', async () => {
    const runRaw = makeRunRaw(ok('{"isDir": false, "size": 1234}\n'));
    const fs = new DeviceFs(runRaw);
    expect(await fs.stat('/main.py')).toEqual({ isDir: false, size: 1234 });
  });

  it('embeds the path in os.stat', async () => {
    const runRaw = makeRunRaw(ok('{"isDir": true, "size": 0}'));
    const fs = new DeviceFs(runRaw);
    await fs.stat('/lib');
    const code = runRaw.mock.calls[0][0];
    expect(code).toContain("os.stat('/lib')");
  });

  it('surfaces ERR: as DeviceFsError', async () => {
    const runRaw = makeRunRaw(ok('ERR:[Errno 2] ENOENT'));
    const fs = new DeviceFs(runRaw);
    await expect(fs.stat('/nope')).rejects.toBeInstanceOf(DeviceFsError);
  });
});

describe('DeviceFs.readBytes', () => {
  it('decodes base64 stdout to bytes', async () => {
    // 'hello' base64 encoded
    const runRaw = makeRunRaw(ok('aGVsbG8=\n'));
    const fs = new DeviceFs(runRaw);
    const bytes = await fs.readBytes('/foo.txt');
    expect(Array.from(bytes)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it('embeds the size limit in the snippet', async () => {
    const runRaw = makeRunRaw(ok('AA=='));
    const fs = new DeviceFs(runRaw);
    await fs.readBytes('/foo.bin');
    const code = runRaw.mock.calls[0][0];
    expect(code).toContain(`if _s[6] > ${256 * 1024}:`);
    expect(code).toContain("print('ERR:File too large to open')");
    expect(code).toContain("open('/foo.bin', 'rb')");
  });

  it('surfaces "File too large to open" as DeviceFsError', async () => {
    const runRaw = makeRunRaw(ok('ERR:File too large to open\n'));
    const fs = new DeviceFs(runRaw);
    await expect(fs.readBytes('/big.bin')).rejects.toBeInstanceOf(DeviceFsError);
    await expect(fs.readBytes('/big.bin')).rejects.toThrow('File too large to open');
  });

  it('throws Error on invalid base64', async () => {
    const runRaw = makeRunRaw(ok('not_base64!!!\n'));
    const fs = new DeviceFs(runRaw);
    const promise = fs.readBytes('/foo');
    await expect(promise).rejects.not.toBeInstanceOf(DeviceFsError);
    await expect(promise).rejects.toThrow(/base64/);
  });

  it('returns an empty Uint8Array for an empty file', async () => {
    // b2a_base64(b'').decode().strip() is '', so the device emits a single
    // newline. The host treats empty stdout as a successful empty read.
    const runRaw = makeRunRaw(ok('\n'));
    const fs = new DeviceFs(runRaw);
    const bytes = await fs.readBytes('/empty.bin');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(0);
  });
});

describe('DeviceFs.readText', () => {
  it('decodes UTF-8 bytes to a string', async () => {
    const runRaw = makeRunRaw(ok('aGVsbG8=\n')); // 'hello'
    const fs = new DeviceFs(runRaw);
    expect(await fs.readText('/foo.txt')).toBe('hello');
  });

  it('throws on invalid UTF-8', async () => {
    // 0xff is not a valid UTF-8 start byte
    const runRaw = makeRunRaw(ok('/w==\n'));
    const fs = new DeviceFs(runRaw);
    await expect(fs.readText('/binary')).rejects.toThrow(/UTF-8/);
  });
});

describe('DeviceFs.writeBytes', () => {
  it('embeds the path and base64 payload', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    await fs.writeBytes('/foo.bin', new Uint8Array([0x68, 0x69])); // 'hi'
    const code = runRaw.mock.calls[0][0];
    expect(code).toContain("open('/foo.bin', 'wb')");
    expect(code).toContain("binascii.a2b_base64(b'aGk=')");
  });

  it('rejects oversized payloads host-side without calling runRaw', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    const tooBig = new Uint8Array(DeviceFs.MAX_WRITE_BYTES + 1);
    const promise = fs.writeBytes('/big.bin', tooBig);
    await expect(promise).rejects.not.toBeInstanceOf(DeviceFsError);
    await expect(promise).rejects.toThrow(/too large/);
    expect(runRaw).not.toHaveBeenCalled();
  });

  it('accepts payloads at exactly the limit', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    await fs.writeBytes('/ok.bin', new Uint8Array(DeviceFs.MAX_WRITE_BYTES));
    expect(runRaw).toHaveBeenCalledOnce();
  });

  it('resolves when stdout is empty', async () => {
    const runRaw = makeRunRaw(ok(''));
    const fs = new DeviceFs(runRaw);
    await expect(fs.writeBytes('/foo', new Uint8Array([1]))).resolves.toBeUndefined();
  });

  it('surfaces ERR: as DeviceFsError', async () => {
    const runRaw = makeRunRaw(ok('ERR:[Errno 13] EACCES\n'));
    const fs = new DeviceFs(runRaw);
    await expect(fs.writeBytes('/readonly', new Uint8Array([1]))).rejects.toBeInstanceOf(
      DeviceFsError,
    );
  });
});

describe('DeviceFs.writeText', () => {
  it('UTF-8 encodes and writes', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    await fs.writeText('/hi.txt', 'hi');
    const code = runRaw.mock.calls[0][0];
    expect(code).toContain("binascii.a2b_base64(b'aGk=')");
  });

  it('handles multibyte characters', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    await fs.writeText('/euro.txt', '€');
    const code = runRaw.mock.calls[0][0];
    // '€' = E2 82 AC = 'a' '4' 'K' 's' '=' in base64
    expect(code).toContain("binascii.a2b_base64(b'4oKs')");
  });
});

describe('DeviceFs.mkdir', () => {
  it('emits os.mkdir', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    await fs.mkdir('/lib');
    expect(runRaw.mock.calls[0][0]).toContain("os.mkdir('/lib')");
  });

  it('surfaces ERR: as DeviceFsError', async () => {
    const runRaw = makeRunRaw(ok('ERR:[Errno 17] EEXIST\n'));
    const fs = new DeviceFs(runRaw);
    await expect(fs.mkdir('/exists')).rejects.toBeInstanceOf(DeviceFsError);
  });
});

describe('DeviceFs.rename', () => {
  it('emits os.rename with both paths', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    await fs.rename('/a.py', '/b.py');
    expect(runRaw.mock.calls[0][0]).toContain("os.rename('/a.py', '/b.py')");
  });

  it('escapes both source and target paths', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    await fs.rename("/o'a", "/o'b");
    expect(runRaw.mock.calls[0][0]).toContain("os.rename('/o\\'a', '/o\\'b')");
  });

  it('surfaces ERR: as DeviceFsError', async () => {
    const runRaw = makeRunRaw(ok('ERR:[Errno 2] ENOENT\n'));
    const fs = new DeviceFs(runRaw);
    await expect(fs.rename('/from', '/to')).rejects.toBeInstanceOf(DeviceFsError);
  });
});

describe('DeviceFs.removeFile', () => {
  it('emits os.remove', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    await fs.removeFile('/foo.txt');
    expect(runRaw.mock.calls[0][0]).toContain("os.remove('/foo.txt')");
  });

  it('surfaces ERR: as DeviceFsError', async () => {
    const runRaw = makeRunRaw(ok('ERR:[Errno 2] ENOENT'));
    const fs = new DeviceFs(runRaw);
    await expect(fs.removeFile('/nope')).rejects.toBeInstanceOf(DeviceFsError);
  });
});

describe('DeviceFs.removeDir', () => {
  it('emits os.rmdir', async () => {
    const runRaw = makeRunRaw(ok());
    const fs = new DeviceFs(runRaw);
    await fs.removeDir('/lib');
    expect(runRaw.mock.calls[0][0]).toContain("os.rmdir('/lib')");
  });

  it('surfaces device "directory not empty" as DeviceFsError', async () => {
    const runRaw = makeRunRaw(ok('ERR:[Errno 39] ENOTEMPTY\n'));
    const fs = new DeviceFs(runRaw);
    await expect(fs.removeDir('/notempty')).rejects.toBeInstanceOf(DeviceFsError);
  });
});

describe('DeviceFs error pass-through', () => {
  it('re-throws the original runRaw rejection unchanged (e.g. ReplDisconnectedError)', async () => {
    class FakeDisconnect extends Error {
      readonly name = 'ReplDisconnectedError';
    }
    const cause = new FakeDisconnect('disconnected');
    const runRaw = vi.fn(async () => {
      throw cause;
    });
    const fs = new DeviceFs(runRaw);
    await expect(fs.list('/')).rejects.toBe(cause);
  });
});
