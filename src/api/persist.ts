import { clear, createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { State } from './store';

export interface Persister {
  readonly persistent: boolean;
  load(): Promise<State | null>;
  save(state: State): Promise<void>;
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
  deleteBlob(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryPersister(): Persister {
  let saved: State | null = null;
  const blobs = new Map<string, Blob>();
  return {
    persistent: false,
    async load() {
      return saved ? structuredClone(saved) : null;
    },
    async save(state) {
      saved = structuredClone(state);
    },
    async putBlob(key, blob) {
      blobs.set(key, blob);
    },
    async getBlob(key) {
      return blobs.get(key) ?? null;
    },
    async deleteBlob(key) {
      blobs.delete(key);
    },
    async clear() {
      saved = null;
      blobs.clear();
    },
  };
}

const STATE_KEY = 'state';
type StoredBlob = { type: string; bytes: ArrayBuffer };

/** Throws when IndexedDB is missing or blocked, for example in some sandboxes and private windows. */
export async function idbPersister(dbName = 'madar'): Promise<Persister> {
  if (typeof indexedDB === 'undefined' || indexedDB === null) throw new Error('IndexedDB is not available.');
  const data: UseStore = createStore(dbName, 'data');
  const blobs: UseStore = createStore(`${dbName}-blobs`, 'blobs');
  await set('probe', 1, data);
  await del('probe', data);
  return {
    persistent: true,
    async load() {
      return (await get<State>(STATE_KEY, data)) ?? null;
    },
    async save(state) {
      await set(STATE_KEY, state, data);
    },
    async putBlob(key, blob) {
      const stored: StoredBlob = { type: blob.type, bytes: await blob.arrayBuffer() };
      await set(key, stored, blobs);
    },
    async getBlob(key) {
      const stored = await get<StoredBlob>(key, blobs);
      return stored ? new Blob([stored.bytes], { type: stored.type }) : null;
    },
    async deleteBlob(key) {
      await del(key, blobs);
    },
    async clear() {
      await clear(data);
      await clear(blobs);
    },
  };
}

export async function openPersister(): Promise<Persister> {
  try {
    return await idbPersister();
  } catch {
    return memoryPersister();
  }
}
