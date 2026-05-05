// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearFolderHandle,
  loadFolderHandle,
  saveFolderHandle,
} from './handleStore';

/**
 * happy-dom does not ship a real IndexedDB. We install a minimal in-memory
 * stand-in that supports the request shapes `handleStore` uses: open with
 * version + onupgradeneeded, transaction(store, mode), and
 * objectStore(name).{put, get, delete}. Each test starts with a fresh
 * indexedDB so the store doesn't bleed across cases.
 */
class FakeIDBRequest<T = unknown> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;

  succeed(value: T) {
    this.result = value;
    queueMicrotask(() => this.onsuccess?.());
  }

  fail(err: DOMException) {
    this.error = err;
    queueMicrotask(() => this.onerror?.());
  }
}

class FakeObjectStore {
  constructor(private store: Map<string, unknown>, private tx: FakeTransaction) {}

  put(value: unknown, key: string): FakeIDBRequest<string> {
    const req = new FakeIDBRequest<string>();
    this.store.set(key, value);
    this.tx.requestSettled(() => req.succeed(key));
    return req;
  }

  get(key: string): FakeIDBRequest<unknown> {
    const req = new FakeIDBRequest<unknown>();
    const result = this.store.get(key);
    this.tx.requestSettled(() => req.succeed(result));
    return req;
  }

  delete(key: string): FakeIDBRequest<undefined> {
    const req = new FakeIDBRequest<undefined>();
    this.store.delete(key);
    this.tx.requestSettled(() => req.succeed(undefined));
    return req;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: DOMException | null = null;
  private pending = 0;
  private settled = false;

  constructor(private storeMap: Map<string, unknown>) {}

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.storeMap, this);
  }

  requestSettled(fire: () => void) {
    this.pending++;
    queueMicrotask(() => {
      fire();
      this.pending--;
      // Schedule completion after the current microtask wave so the request's
      // onsuccess can fire before tx.oncomplete (matching real IndexedDB).
      queueMicrotask(() => {
        if (this.pending === 0 && !this.settled) {
          this.settled = true;
          this.oncomplete?.();
        }
      });
    });
  }
}

class FakeIDBDatabase {
  constructor(private storeMap: Map<string, unknown>) {}
  transaction(): FakeTransaction {
    return new FakeTransaction(this.storeMap);
  }
  createObjectStore() {
    // No-op: our store map is already shared across "object stores".
  }
  close() {}
}

interface FakeIndexedDBState {
  storeMap: Map<string, unknown>;
}

function installFakeIndexedDB(): FakeIndexedDBState {
  const state: FakeIndexedDBState = { storeMap: new Map() };
  let initialized = false;
  const fakeIndexedDB = {
    open() {
      const req = new FakeIDBRequest<FakeIDBDatabase>();
      queueMicrotask(() => {
        // Real IndexedDB populates `req.result` before firing
        // onupgradeneeded so the handler can call createObjectStore on it.
        const db = new FakeIDBDatabase(state.storeMap);
        req.result = db;
        if (!initialized) {
          initialized = true;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', {
    value: fakeIndexedDB,
    configurable: true,
    writable: true,
  });
  return state;
}

function uninstallIndexedDB() {
  // Reset to undefined; subsequent installs overwrite via defineProperty.
  Object.defineProperty(globalThis, 'indexedDB', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

function fakeHandle(name = 'project'): FileSystemDirectoryHandle {
  return { kind: 'directory', name } as unknown as FileSystemDirectoryHandle;
}

describe('handleStore', () => {
  beforeEach(() => {
    installFakeIndexedDB();
  });

  afterEach(() => {
    uninstallIndexedDB();
  });

  it('returns null when nothing has been stored', async () => {
    expect(await loadFolderHandle()).toBeNull();
  });

  it('round-trips a handle through save → load', async () => {
    const handle = fakeHandle('my-folder');
    await saveFolderHandle(handle);
    const loaded = await loadFolderHandle();
    expect(loaded).toBe(handle);
  });

  it('overwrites the previous handle on subsequent save', async () => {
    await saveFolderHandle(fakeHandle('first'));
    const second = fakeHandle('second');
    await saveFolderHandle(second);
    expect(await loadFolderHandle()).toBe(second);
  });

  it('clear removes the stored handle', async () => {
    await saveFolderHandle(fakeHandle('temp'));
    await clearFolderHandle();
    expect(await loadFolderHandle()).toBeNull();
  });

  it('returns null and swallows errors when IndexedDB is unavailable', async () => {
    uninstallIndexedDB();
    expect(await loadFolderHandle()).toBeNull();
    // Save / clear must not throw either — the call sites await them in
    // contexts that should not care if persistence is unavailable.
    await expect(saveFolderHandle(fakeHandle())).resolves.toBeUndefined();
    await expect(clearFolderHandle()).resolves.toBeUndefined();
  });
});
