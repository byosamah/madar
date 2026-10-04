import { FILE_STORE_LIMITS, type FileStoreKind, type FilesPort } from '../../core/ports';
import { storedMimeType } from '../../files/links';

export type FakeFiles = FilesPort & {
  /** The stored objects by key. A test puts an object here to stand for a browser upload. */
  objects: Map<string, { size: number; mimeType: string }>;
  calls: { op: string; key: string }[];
};

/** Files in memory. headDelayMs makes head wait, to prove that a slow store never holds the office lock. */
export function fakeFiles(o: { kind?: FileStoreKind; headDelayMs?: number; maxFileBytes?: number } = {}): FakeFiles {
  const kind = o.kind ?? 'supabase';
  const objects = new Map<string, { size: number; mimeType: string }>();
  const calls: { op: string; key: string }[] = [];
  const expiresAt = '2099-01-01T00:00:00.000Z';
  return {
    kind,
    maxFileBytes: o.maxFileBytes ?? FILE_STORE_LIMITS[kind].maxFileBytes,
    objects,
    calls,
    async presignPut(key, put) {
      calls.push({ op: 'presignPut', key });
      // Both stores sign the stored type: a type that may not show in the browser becomes application/octet-stream.
      return { url: `https://files.test/put/${key}`, headers: { 'Content-Type': storedMimeType(put.mimeType) }, expiresAt };
    },
    async presignGet(key, get) {
      calls.push({ op: 'presignGet', key });
      return { url: `https://files.test/get/${key}?disposition=${get.disposition}`, expiresAt };
    },
    async head(key) {
      calls.push({ op: 'head', key });
      if (o.headDelayMs) await new Promise((resolve) => setTimeout(resolve, o.headDelayMs));
      return objects.get(key) ?? null;
    },
    async copy(from, to) {
      calls.push({ op: 'copy', key: `${from}>${to}` });
      const object = objects.get(from);
      if (!object) throw new Error(`No object at ${from}.`);
      // Storage refuses a copy onto a key that holds an object (KeyAlreadyExists).
      if (objects.has(to)) throw new Error(`An object is already at ${to}.`);
      objects.set(to, { ...object });
    },
    async remove(keys) {
      calls.push({ op: 'remove', key: keys.join(',') });
      for (const key of keys) objects.delete(key);
    },
  };
}
