import type { FilesPort } from '../core/ports';
import { isEnterpriseId, type EnterpriseId } from '../enterprise/ids';
import { keyBelongsTo } from './keys';

/** The one text of every refusal. It names no key and no enterprise. */
export const FILE_KEY_REFUSED = 'The file key is not valid.';
/** The refusal to make a file port with no enterprise. */
export const ENT_REQUIRED = 'A file port needs the id of its enterprise.';

/** Throws unless the key has the key form and belongs to the enterprise. */
export function assertKeyOf(ent: EnterpriseId, key: string): void {
  if (typeof key !== 'string' || !keyBelongsTo(ent, key)) throw new Error(FILE_KEY_REFUSED);
}

/**
 * A file port that works inside the key folder of one enterprise (Madar enterprises, design 5.11). Each method checks every key before
 * it calls the store: a key without the prefix of the enterprise, or with the prefix of another one, is refused. A copy checks both keys,
 * and a remove checks all keys before it removes any. The Worker wraps its port with this guard for the enterprise of the request, and
 * the office object wraps its network port the same way: two walls.
 */
export function guardFilesPort(port: FilesPort, ent: EnterpriseId): FilesPort {
  // The enterprise is a required input with no default. A caller that forgets it (a JS caller, or a cast) fails here and never gets a port
  // that works for ENT_VADO by chance.
  if (!isEnterpriseId(ent)) throw new Error(ENT_REQUIRED);
  return {
    kind: port.kind,
    maxFileBytes: port.maxFileBytes,
    // Each method is async, so a refusal is a rejected promise and never a throw at the call site.
    presignPut: async (key, o) => {
      assertKeyOf(ent, key);
      return port.presignPut(key, o);
    },
    presignGet: async (key, o) => {
      assertKeyOf(ent, key);
      return port.presignGet(key, o);
    },
    head: async (key, o) => {
      assertKeyOf(ent, key);
      return port.head(key, o);
    },
    copy: async (from, to) => {
      assertKeyOf(ent, from);
      assertKeyOf(ent, to);
      return port.copy(from, to);
    },
    remove: async (keys) => {
      for (const key of keys) assertKeyOf(ent, key);
      return port.remove(keys);
    },
  };
}
