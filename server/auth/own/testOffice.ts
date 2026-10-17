import type { DatabaseSync } from 'node:sqlite';
import { buildSeed } from '../../../src/data/seed';
import type { Deps } from '../../core/ports';
import { createRunCall } from '../../core/runCall';
import type { RunResult } from '../../core/types';
import { liteData } from '../../data/lite/callData';
import type { LiteDb } from '../../data/lite/db';
import { readLiteOffice, setLiteAuthLink } from '../../data/lite/office';
import { freshLite } from '../../data/lite/testDb';
import { liteWriteState } from '../../data/lite/whole';
import { fakeDeps, type FakeDeps } from '../../test/fakes/deps';
import type { AuthAdmin } from '../admin';
import { liteAuthAdmin } from './liteAdmin';
import { hashPassword } from './password';
import { AUTH_USER_INSERT } from './rows';

/**
 * For tests only: the sample office on node:sqlite with the deps of the SQLite path (liteAuthAdmin in place of the Supabase fake),
 * and runCall on liteData, so a call runs as the office object runs it. Mail goes to the fake mail port.
 */
export type LiteFakeDeps = Omit<FakeDeps, 'authAdmin'> & { authAdmin: AuthAdmin };
export type TestOffice = {
  raw: DatabaseSync;
  db: LiteDb;
  deps: LiteFakeDeps;
  call(actorId: string, name: string, input: unknown): Promise<RunResult>;
};

export async function signinOffice(o: { at?: string } = {}): Promise<TestOffice> {
  const at = o.at ?? '2026-10-17T06:00:00Z';
  const { raw, db } = await freshLite();
  const seed = await buildSeed(at.slice(0, 10), async () => undefined);
  await db.tx('write', (q) => liteWriteState(q, seed));
  const base = fakeDeps({ db });
  base.clock.set(new Date(at));
  const deps: LiteFakeDeps = { ...base, authAdmin: liteAuthAdmin({ db, clock: base.clock }) };
  const run = createRunCall({ data: liteData });
  return {
    raw, db, deps,
    call: (actorId, name, input) => run(deps as unknown as Deps, { principal: { userId: actorId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } }),
  };
}

/** One value of the button link of a sign-in mail: token_hash (the link token) or renew (the renew key). */
export function linkValueOfMail(html: string, name: 'token_hash' | 'renew'): string {
  const href = /href="([^"]+)"/.exec(html)?.[1];
  if (!href) throw new Error('The mail has no button link.');
  const value = new URL(href.replace(/&amp;/g, '&')).searchParams.get(name);
  if (value === null) throw new Error(`The button link has no ${name}.`);
  return value;
}

/** A sign-in row for a person of the office, linked to that person; with a password, the person has accepted. */
export async function addSignIn(t: TestOffice, userId: string, o: { password?: string; confirmed?: boolean } = {}): Promise<string> {
  const user = (await t.db.tx('read', (q) => readLiteOffice(t.db, q))).lists.users[userId];
  if (!user) throw new Error(`No person ${userId} in the test office.`);
  const authId = crypto.randomUUID();
  const hash = o.password === undefined ? null : await hashPassword(o.password);
  await t.db.tx('write', async (q) => {
    await q(AUTH_USER_INSERT, [authId, user.email.toLowerCase(), hash, hash === null ? 0 : 1, o.confirmed === false ? 0 : 1, t.deps.clock.now().toISOString()]);
    await setLiteAuthLink(q, userId, authId);
  });
  return authId;
}
