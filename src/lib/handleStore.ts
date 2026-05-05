// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

/**
 * Persists the user's most recently opened local folder so the app can
 * auto-restore it on reload. `FileSystemDirectoryHandle` is structured-
 * cloneable but not JSON-serialisable, so we use IndexedDB rather than
 * localStorage. Errors (IndexedDB unavailable, quota, schema mismatch) are
 * swallowed — the app falls back to the manual "Open Folder" path.
 */

const DB_NAME = 'cobweb';
const STORE_NAME = 'handles';
const KEY = 'lastFolder';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  task: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const req = task(store);
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        req.onerror = () => reject(req.error);
        // Resolve only after the tx commits — for writes, this is when the
        // value is durable; for reads, the result is already populated.
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      })
      .catch(reject);
  });
}

export async function saveFolderHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(handle, KEY));
  } catch {
    // ignore
  }
}

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const result = await withStore<FileSystemDirectoryHandle | undefined>(
      'readonly',
      (s) => s.get(KEY),
    );
    return result ?? null;
  } catch {
    return null;
  }
}

export async function clearFolderHandle(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch {
    // ignore
  }
}
