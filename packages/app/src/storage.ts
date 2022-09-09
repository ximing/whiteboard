import type { EditorStorage } from '@plume/editor';
import { deserialize, serialize, STORAGE_KEY, type Document } from '@plume/model';

const DB_NAME = 'plume';
const STORE = 'kv';

export function readLocal(): Document | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function writeLocal(doc: Document): void {
  const json = serialize(doc);
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    try {
      const slim: Document = {
        ...doc,
        objects: doc.objects.map((object) => (object.type === 'image' ? { ...object, dataUrl: '' } : object)),
      };
      localStorage.setItem(STORAGE_KEY, serialize(slim));
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

export async function writeIdb(doc: Document): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  let existing: Document | null = null;
  try {
    existing = await readIdb();
  } catch {
    existing = null;
  }
  const merged = preparePersist(doc, existing);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(serialize(merged), STORAGE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readIdb(): Promise<Document | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDb();
  const json = await new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(STORAGE_KEY);
    request.onsuccess = () => resolve(request.result as string | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!json) return null;
  return deserialize(json);
}

function imageRichness(doc: Document): number {
  return doc.objects.reduce((total, object) => total + (object.type === 'image' ? object.dataUrl.length : 0), 0);
}

export function restoreImageBytes(doc: Document, donor: Document | null): Document {
  if (!donor) return doc;
  const bytes = new Map<string, string>();
  for (const object of donor.objects) {
    if (object.type === 'image' && object.dataUrl.length > 0) bytes.set(object.id, object.dataUrl);
  }
  if (bytes.size === 0) return doc;
  let changed = false;
  const objects = doc.objects.map((object) => {
    if (object.type !== 'image' || object.dataUrl.length > 0) return object;
    const dataUrl = bytes.get(object.id);
    if (!dataUrl) return object;
    changed = true;
    return { ...object, dataUrl };
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

let persistTimer = 0;

/** Browser persistence for the demo site. A product can replace this. */
export const browserStorage: EditorStorage = {
  read: () => readLocal(),
  async load() {
    let stored: Document | null = null;
    try {
      stored = await readIdb();
    } catch {
      stored = null;
    }
    return loadBest(readLocal(), stored);
  },
  save(doc) {
    writeLocal(doc);
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      void writeIdb(doc).catch(() => {});
    }, 60);
  },
  flush(doc) {
    writeLocal(doc);
    void writeIdb(doc).catch(() => {});
  },
};
