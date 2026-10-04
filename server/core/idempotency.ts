import { ApiError } from '../../src/api/errors';
import type { Query } from './ports';

/**
 * Idempotency keys of batch writes (plan 4.10; task C3). The browser makes a new key for each write and sends it again only from
 * the Retry button, so a lost answer and a Retry never post twice.
 *
 * - The key belongs to the actor. runCall reads it after the office lock, so two calls with one key never both run.
 * - The digest is sha256 of the call name and the canonical JSON of the parsed input. The same key and digest give the stored
 *   answer and run nothing. The same key with another digest gives conflict with the reason key_reused.
 * - The answer goes into the table in the call's own transaction, so a call that fails stores nothing and a Retry runs again.
 * - The job (track N3) deletes keys older than 24 hours.
 */

export const KEY_SELECT_SQL = 'select name, digest, result from idempotency where actor_id = $1 and key = $2';
export const KEY_INSERT_SQL =
  'insert into idempotency (actor_id, key, name, digest, result, created_at) values ($1, $2, $3, $4, $5::jsonb, $6)';

/** What a replay gives back. The signals are not kept: the first run sent them. */
export type StoredResult = { output: unknown; storyId?: string; changed: boolean };
export type KeyRow = { name: string; digest: string; result: StoredResult };

export interface KeyStore {
  get(actorId: string, key: string): Promise<KeyRow | undefined>;
  put(row: KeyRow & { actorId: string; key: string; at: Date }): Promise<void>;
}

export function sqlKeys(q: Query): KeyStore {
  return {
    async get(actorId, key) {
      const [row] = await q<KeyRow>(KEY_SELECT_SQL, [actorId, key]);
      return row;
    },
    async put(row) {
      await q(KEY_INSERT_SQL, [row.actorId, row.key, row.name, row.digest, JSON.stringify(row.result), row.at.toISOString()]);
    },
  };
}

/** JSON with sorted keys and no undefined fields, so one input gives one text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).filter((key) => rec[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(rec[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function digestOf(name: string, input: unknown): Promise<string> {
  const data = new TextEncoder().encode(`${name}\n${canonicalJson(input)}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The stored answer of a key, or undefined for a new key. The same key with another call or input is refused. */
export function replay(found: KeyRow | undefined, digest: string): StoredResult | undefined {
  if (!found) return undefined;
  if (found.digest !== digest) {
    throw new ApiError('conflict', 'This retry key belongs to another action. Reload and try again.', { reason: 'key_reused' });
  }
  return found.result;
}
