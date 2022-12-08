import type { EditorStorage } from '@plume/editor';
import { deserialize, serialize, STORAGE_KEY, type Document } from '@plume/model';

const DB_NAME = 'plume';
const STORE = 'kv';

export function boardKey(boardId = 'home'): string {
  return boardId === 'home' ? STORAGE_KEY : `${STORAGE_KEY}.${boardId}`;
}

export function readLocal(boardId = 'home'): Document | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(boardKey(boardId));
    if (!raw) return null;
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function writeLocal(doc: Document, boardId = 'home'): void {
  const json = serialize(doc);
  const key = boardKey(boardId);
  try {
    localStorage.setItem(key, json);
  } catch {
    try {
      const slim: Document = {
        ...doc,
        objects: doc.objects.map((object) => (object.type === 'image' ? { ...object, src: '' } : object)),
      };
      localStorage.setItem(key, serialize(slim));
    } catch {
      /* The full board still goes to IndexedDB. */
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function writeIdb(doc: Document, boardId = 'home'): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  let existing: Document | null = null;
  try {
    existing = await readIdb(boardId);
  } catch {
    existing = null;
  }
  const merged = preparePersist(doc, existing);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(serialize(merged), boardKey(boardId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readIdb(boardId = 'home'): Promise<Document | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDb();
  const json = await new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(boardKey(boardId));
    request.onsuccess = () => resolve(request.result as string | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!json) return null;
  return deserialize(json);
}

function imageRichness(doc: Document): number {
  return doc.objects.reduce((total, object) => total + (object.type === 'image' ? object.src.length : 0), 0);
}

export function restoreImageBytes(doc: Document, donor: Document | null): Document {
  if (!donor) return doc;
  const bytes = new Map<string, string>();
  for (const object of donor.objects) {
    if (object.type === 'image' && object.src.length > 0) bytes.set(object.id, object.src);
  }
  if (bytes.size === 0) return doc;
  let changed = false;
  const objects = doc.objects.map((object) => {
    if (object.type !== 'image' || object.src.length > 0) return object;
    const src = bytes.get(object.id);
    if (!src) return object;
    changed = true;
    return { ...object, src };
  });
  return changed ? { ...doc, objects } : doc;
}

export function loadBest(local: Document | null, stored: Document | null): Document | null {
  if (!local) return stored;
  if (!stored) return local;
  if (local.rev !== stored.rev) {
    const newer = local.rev > stored.rev ? local : stored;
    const older = newer === local ? stored : local;
    return restoreImageBytes(newer, older);
  }
  const chosen = imageRichness(stored) >= imageRichness(local) ? stored : local;
  const other = chosen === stored ? local : stored;
  return restoreImageBytes(chosen, other);
}

export function preparePersist(next: Document, previous: Document | null): Document {
  return restoreImageBytes(next, previous);
}

const persistTimers = new Map<string, number>();

/** Browser persistence for one board. `home` keeps the original storage key. */
export async function deleteBoardStorage(boardId: string): Promise<void> {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(boardKey(boardId));
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(boardKey(boardId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function browserStorageFor(boardId: string): EditorStorage {
  return {
    read: () => readLocal(boardId),
    async load() {
      let stored: Document | null = null;
      try {
        stored = await readIdb(boardId);
      } catch {
        stored = null;
      }
      return loadBest(readLocal(boardId), stored);
    },
    save(doc) {
      writeLocal(doc, boardId);
      window.clearTimeout(persistTimers.get(boardId));
      persistTimers.set(
        boardId,
        window.setTimeout(() => {
          void writeIdb(doc, boardId).catch(() => {});
        }, 60),
      );
    },
    flush(doc) {
      writeLocal(doc, boardId);
      void writeIdb(doc, boardId).catch(() => {});
    },
  };
}

/** Browser persistence for the original single board. */
export const browserStorage = browserStorageFor('home');
