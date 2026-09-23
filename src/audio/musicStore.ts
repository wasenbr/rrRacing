/** Músicas escolhidas pelo jogador, guardadas no próprio navegador (IndexedDB). */
export interface StoredTrack {
  id?: number;
  name: string;
  blob: Blob;
}

const DB = 'rnrr3d';
const STORE = 'music';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function loadTracks(): Promise<StoredTrack[]> {
  try {
    return await tx<StoredTrack[]>('readonly', (s) => s.getAll() as IDBRequest<StoredTrack[]>);
  } catch {
    return [];
  }
}

export async function addTracks(files: File[]): Promise<void> {
  for (const f of files) await tx('readwrite', (s) => s.add({ name: f.name.replace(/\.[^.]+$/, ''), blob: f }));
}

export async function clearTracks(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* ignora */
  }
}
