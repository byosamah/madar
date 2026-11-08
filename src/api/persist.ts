import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';
import type { State } from './store';
import { VADO_ENTERPRISE } from './vadoEnterprise';

export interface Persister {
  readonly persistent: boolean;
  /** The fake enterprise that this store belongs to (Madar enterprises). Each enterprise has its own state and its own blobs. */
  readonly ent: string;
  load(): Promise<State | null>;
  save(state: State): Promise<void>;
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
  deleteBlob(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryPersister(ent: string = VADO_ENTERPRISE): Persister {
  let saved: State | null = null;
  const blobs = new Map<string, Blob>();
  return {
    persistent: false,
    ent,
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

/** The state key of the old build, before the stores were split by enterprise. Only VADOs' Companies reads and moves it. */
const OLD_STATE_KEY = 'state';
/** A blob key of another enterprise starts with its id and a colon. Any other blob key is an old key of VADOs' Companies. */
const ENTERPRISE_BLOB_KEY = /^ent_\d{3,}:/;
type StoredBlob = { type: string; bytes: ArrayBuffer };

/**
 * Throws when IndexedDB is missing or blocked, for example in some sandboxes and private windows.
 * The state is under `state:<ent>` and a blob under `<ent>:<key>`. ent_001 still reads the old keys, and its next save moves the state.
 */
export async function idbPersister(dbName = 'madar', ent: string = VADO_ENTERPRISE): Promise<Persister> {
  if (typeof indexedDB === 'undefined' || indexedDB === null) throw new Error('IndexedDB is not available.');
  const data: UseStore = createStore(dbName, 'data');
  const blobs: UseStore = createStore(`${dbName}-blobs`, 'blobs');
  await set('probe', 1, data);
  await del('probe', data);
  const stateKey = `state:${ent}`;
  const blobKey = (key: string) => `${ent}:${key}`;
  const owner = ent === VADO_ENTERPRISE;
  return {
    persistent: true,
    ent,
    async load() {
      return (await get<State>(stateKey, data)) ?? (owner ? ((await get<State>(OLD_STATE_KEY, data)) ?? null) : null);
    },
    async save(state) {
      await set(stateKey, state, data);
      if (owner) await del(OLD_STATE_KEY, data);
    },
    async putBlob(key, blob) {
      const stored: StoredBlob = { type: blob.type, bytes: await blob.arrayBuffer() };
      await set(blobKey(key), stored, blobs);
    },
    async getBlob(key) {
      const stored = (await get<StoredBlob>(blobKey(key), blobs)) ?? (owner ? await get<StoredBlob>(key, blobs) : undefined);
      return stored ? new Blob([stored.bytes], { type: stored.type }) : null;
    },
    async deleteBlob(key) {
      await del(blobKey(key), blobs);
      if (owner) await del(key, blobs);
    },
    async clear() {
      await del(stateKey, data);
      if (owner) await del(OLD_STATE_KEY, data);
      for (const key of await keys<string>(blobs)) {
        const mine = owner ? !ENTERPRISE_BLOB_KEY.test(key) || key.startsWith(`${ent}:`) : key.startsWith(`${ent}:`);
        if (mine) await del(key, blobs);
      }
    },
  };
}

export async function openPersister(ent: string = VADO_ENTERPRISE): Promise<Persister> {
  try {
    return await idbPersister('madar', ent);
  } catch {
    return memoryPersister(ent);
  }
}
