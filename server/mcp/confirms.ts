import { sqlFor } from '../data/dialect';
import type { Query } from '../core/ports';

/**
 * The store of the email code guard (owner decision, 2026-10-26; supabase/migrations/20261026000100_agent_confirms.sql). One row is
 * one request of an agent for a risky Admin act: the person, the agent, the call name, a hash of the exact input (without the code), a
 * hash of the 6-digit code, the end time, the count of wrong tries and the time of use. The row never holds the code itself.
 *
 * ConfirmStore is the shape that runCall uses. sqlConfirms is the database form, on Postgres and on SQLite. The memory data of the unit
 * tests (server/core/memoryData.ts) has its own copy, so a test runs the guard with no SQL.
 */

/** A code lives 10 minutes. */
export const CODE_TTL_MS = 10 * 60_000;
/** A row dies at its fifth wrong try. */
export const MAX_TRIES = 5;
/** At most this many new codes for one person in one hour. A tricked agent cannot fill the mailbox of the person. */
export const MAX_NEW_PER_HOUR = 5;
export const HOUR_MS = 3_600_000;

export type ConfirmRow = { id: string; codeHash: string; tries: number; expiresAt: Date };
export type NewConfirm = {
  id: string; personId: string; agentId: string; call: string; inputHash: string; codeHash: string; expiresAt: Date; createdAt: Date;
};

export interface ConfirmStore {
  /** The newest row of this agent, call and input hash that is not used, not expired and not dead. */
  live(o: { personId: string; agentId: string; call: string; inputHash: string; now: Date }): Promise<ConfirmRow | undefined>;
  add(row: NewConfirm): Promise<void>;
  /** One more wrong try. */
  wrong(id: string): Promise<void>;
  /** Marks the row used, once. False when it was used, expired or dead already (a second call with the same code). */
  claim(id: string, now: Date): Promise<boolean>;
  /** How many rows this person got since the given time. */
  madeSince(personId: string, since: Date): Promise<number>;
}

export const CONFIRM_LIVE_SQL =
  'select id, code_hash, tries, expires_at from agent_confirms where person_id = $1 and agent_id = $2 and call_name = $3 and input_hash = $4 '
  + 'and used_at is null and tries < $5 and expires_at > $6 order by created_at desc, id desc limit 1';
export const CONFIRM_LIVE_LITE =
  'select id, code_hash, tries, expires_at from agent_confirms where person_id = ?1 and agent_id = ?2 and call_name = ?3 and input_hash = ?4 '
  + 'and used_at is null and tries < ?5 and expires_at > ?6 order by created_at desc, id desc limit 1';
export const CONFIRM_ADD_SQL =
  'insert into agent_confirms (id, person_id, agent_id, call_name, input_hash, code_hash, expires_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)';
export const CONFIRM_ADD_LITE =
  'insert into agent_confirms (id, person_id, agent_id, call_name, input_hash, code_hash, expires_at, created_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)';
export const CONFIRM_WRONG_SQL = 'update agent_confirms set tries = tries + 1 where id = $1';
export const CONFIRM_WRONG_LITE = 'update agent_confirms set tries = tries + 1 where id = ?1';
export const CONFIRM_CLAIM_SQL =
  'update agent_confirms set used_at = $2 where id = $1 and used_at is null and tries < $3 and expires_at > $2 returning id';
export const CONFIRM_CLAIM_LITE =
  'update agent_confirms set used_at = ?2 where id = ?1 and used_at is null and tries < ?3 and expires_at > ?2 returning id';
export const CONFIRM_MADE_SQL = 'select count(*) as n from agent_confirms where person_id = $1 and created_at >= $2';
export const CONFIRM_MADE_LITE = 'select count(*) as n from agent_confirms where person_id = ?1 and created_at >= ?2';

type LiveRow = { id: string; code_hash: string; tries: number | string; expires_at: Date | string };

/** The database form. q is the query of the transaction, so the claim of a code commits with the act, and rolls back with it. */
export function sqlConfirms(q: Query): ConfirmStore {
  return {
    async live(o) {
      const [row] = await q<LiveRow>(sqlFor(q, CONFIRM_LIVE_SQL, CONFIRM_LIVE_LITE), [
        o.personId, o.agentId, o.call, o.inputHash, MAX_TRIES, o.now.toISOString(),
      ]);
      return row ? { id: row.id, codeHash: row.code_hash, tries: Number(row.tries), expiresAt: new Date(row.expires_at) } : undefined;
    },
    async add(row) {
      await q(sqlFor(q, CONFIRM_ADD_SQL, CONFIRM_ADD_LITE), [
        row.id, row.personId, row.agentId, row.call, row.inputHash, row.codeHash, row.expiresAt.toISOString(), row.createdAt.toISOString(),
      ]);
    },
    async wrong(id) {
      await q(sqlFor(q, CONFIRM_WRONG_SQL, CONFIRM_WRONG_LITE), [id]);
    },
    async claim(id, now) {
      const rows = await q(sqlFor(q, CONFIRM_CLAIM_SQL, CONFIRM_CLAIM_LITE), [id, now.toISOString(), MAX_TRIES]);
      return rows.length === 1;
    },
    async madeSince(personId, since) {
      const [row] = await q<{ n: number | string }>(sqlFor(q, CONFIRM_MADE_SQL, CONFIRM_MADE_LITE), [personId, since.toISOString()]);
      return Number(row?.n ?? 0);
    },
  };
}

/** The row of the memory data. */
export type MemoryConfirm = NewConfirm & { tries: number; usedAt: Date | null };

/** The memory form, for the unit tests: the rows of one draft of memoryData. */
export function memoryConfirms(rows: Map<string, MemoryConfirm>): ConfirmStore {
  return {
    async live(o) {
      const found = [...rows.values()]
        .filter((row) => row.personId === o.personId && row.agentId === o.agentId && row.call === o.call && row.inputHash === o.inputHash
          && row.usedAt === null && row.tries < MAX_TRIES && row.expiresAt.getTime() > o.now.getTime())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))[0];
      return found ? { id: found.id, codeHash: found.codeHash, tries: found.tries, expiresAt: found.expiresAt } : undefined;
    },
    async add(row) {
      if (rows.has(row.id)) throw new Error(`duplicate key value: agent_confirms ${row.id}`);
      rows.set(row.id, { ...row, tries: 0, usedAt: null });
    },
    async wrong(id) {
      const row = rows.get(id);
      if (row) row.tries += 1;
    },
    async claim(id, now) {
      const row = rows.get(id);
      if (!row || row.usedAt !== null || row.tries >= MAX_TRIES || row.expiresAt.getTime() <= now.getTime()) return false;
      row.usedAt = now;
      return true;
    },
    async madeSince(personId, since) {
      return [...rows.values()].filter((row) => row.personId === personId && row.createdAt.getTime() >= since.getTime()).length;
    },
  };
}

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** The hash that the table keeps: sha256 of the row id and the code, so two rows with one code differ. */
export async function codeHashOf(id: string, code: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${id}:${code}`))));
}

/** A compare that takes the same time for any two hashes of one length. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A 6-digit code from the secure random source, with no modulo bias: 000000 to 999999. */
export function newCode(): string {
  const limit = 4_294_967_296 - (4_294_967_296 % 1_000_000);
  const one = new Uint32Array(1);
  do {
    crypto.getRandomValues(one);
  } while (one[0] >= limit);
  return String(one[0] % 1_000_000).padStart(6, '0');
}

export function newConfirmId(): string {
  return `cnf_${hex(crypto.getRandomValues(new Uint8Array(10)))}`;
}
