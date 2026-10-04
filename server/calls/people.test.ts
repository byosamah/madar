import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { nowStamp } from '../../src/lib/dates';
import { fakeAuth } from '../auth/fakeAuth';
import { RATE_SQL } from '../auth/rateLimit';
import { OUTBOX_INSERT_SQL } from '../core/effects';
import { KEY_INSERT_SQL, KEY_SELECT_SQL } from '../core/idempotency';
import { LOCK_SQL } from '../core/lock';
import type { Db, Query } from '../core/ports';
import { STORY_INSERT_SQL } from '../core/story';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { createUsersResendInvite, INVITE_LINKS_SQL, INVITE_SENT_SQL, RESEND_PER_DAY, usersInvites } from './people';

/**
 * users.invites and users.resendInvite (plan 4.11 and 5.1; task P2) on a small database in memory that answers the exact
 * statements of the calls. server/it/invites.it.test.ts runs them on the local stack.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

type Tables = {
  links: Record<string, string | null>;
  sent: Record<string, string>;
  keys: Record<string, { name: string; digest: string; result: unknown }>;
  stories: Record<string, string>;
  rates: Record<string, number>;
  outbox: { id: string; kind: string; payload: Record<string, unknown> }[];
};

/** The tables as one JSON value: a transaction works on a copy and keeps it only when the work returns. */
function memoryDb(): Db & { tables: Tables; txs: number } {
  let tables: Tables = { links: {}, sent: {}, keys: {}, stories: {}, rates: {}, outbox: [] };
  const queryOn = (t: Tables): Query => (async (text: string, values: unknown[] = []) => {
    const v = values as string[];
    if (text === LOCK_SQL) return [];
    if (text === INVITE_LINKS_SQL) return Object.entries(t.links).map(([id, auth]) => ({ id, auth }));
    if (text === INVITE_SENT_SQL) return Object.entries(t.sent).map(([user_id, sent_at]) => ({ user_id, sent_at: new Date(sent_at) }));
    if (text === KEY_SELECT_SQL) return t.keys[`${v[0]}|${v[1]}`] ? [t.keys[`${v[0]}|${v[1]}`]] : [];
    if (text === KEY_INSERT_SQL) {
      t.keys[`${v[0]}|${v[1]}`] = { name: v[2], digest: v[3], result: JSON.parse(v[4]) };
      return [];
    }
    if (text === STORY_INSERT_SQL) {
      t.stories[v[0]] = v[1];
      return [];
    }
    if (text === RATE_SQL) {
      const id = `${v[0]}|${v[1]}`;
      t.rates[id] = (t.rates[id] ?? 0) + 1;
      return [{ count: t.rates[id] }];
    }
    if (text === OUTBOX_INSERT_SQL) {
      const rows = JSON.parse(v[0]) as { kind: string; payload: Record<string, unknown> }[];
      return rows.map((row) => {
        const id = String(t.outbox.length + 1);
        t.outbox.push({ id, ...row });
        return { id };
      });
    }
    throw new Error(`The memory database has no answer for: ${text.slice(0, 80)}`);
  }) as Query;
  const db = {
    get tables() {
      return tables;
    },
    txs: 0,
    async tx<T>(_mode: 'read' | 'write', work: (q: Query) => Promise<T>): Promise<T> {
      db.txs += 1;
      const copy = structuredClone(tables);
      const result = await work(queryOn(copy));
      tables = copy;
      return result;
    },
    async savepoint<T>(q: Query, work: (q: Query) => Promise<T>) {
      return work(q);
    },
    async statement<R>(_mode: 'read' | 'write', text: string, values?: unknown[]) {
      return queryOn(tables)(text, values) as Promise<R[]>;
    },
  };
  return db;
}

function setup(o: { userId?: string; afterCommit?: (deps: unknown, ids: string[]) => Promise<unknown> } = {}) {
  const db = memoryDb();
  const deps = fakeDeps({ db });
  deps.clock.set(NOW);
  const auth = fakeAuth(deps.authAdmin);
  deps.authAdmin = auth;
  const ran: string[][] = [];
  const resend = createUsersResendInvite({ afterCommit: o.afterCommit ?? (async (_d, ids) => void ran.push(ids)) });
  const ctx = (userId = o.userId ?? 'usr_001', more: Partial<ServerCallCtx> = {}): ServerCallCtx => ({
    deps, principal: userId === 'usr_009' ? { userId, agent: { clientId: 'cli' } } : { userId }, office: snapshotOf(seed, 1),
    batch: { storyRefs: new Map(), overviewCalls: 0 }, now: deps.clock.now(), ...more,
  });
  return { db, deps: deps as FakeDeps & { db: typeof db }, auth, ran, resend, ctx };
}

async function refusal(work: Promise<unknown>): Promise<ApiError> {
  const error = await work.then(() => null, (e: unknown) => e);
  if (!(error instanceof ApiError)) throw new Error(`It did not refuse with an ApiError: ${String(error)}`);
  return error;
}

describe('users.invites', () => {
  it('gives each person the state of their sign-in: active after they confirmed the email, else invited, with the last send', async () => {
    const { db, auth, ctx } = setup();
    const admin = await auth.createUser('hala.nasser@madar.test', 'pw-12345678');
    const accepted = await auth.generateLink('invite', 'faisal.al.harbi@madar.test');
    auth.accept(accepted.authUserId);
    const waiting = await auth.generateLink('invite', 'reem.al.ghamdi@madar.test');
    Object.assign(db.tables.links, { usr_001: admin.authUserId, usr_002: accepted.authUserId, usr_003: waiting.authUserId, usr_004: null });
    db.tables.sent.usr_003 = '2026-10-03T07:30:00.000Z';
    const { output } = await usersInvites({}, ctx());
    const byId = Object.fromEntries(output.map((row) => [row.userId, row]));
    expect(byId.usr_001).toEqual({ userId: 'usr_001', state: 'active', sentAt: null });
    expect(byId.usr_002).toEqual({ userId: 'usr_002', state: 'active', sentAt: null });
    expect(byId.usr_003).toEqual({ userId: 'usr_003', state: 'invited', sentAt: '2026-10-03T10:30:00.000+03:00' });
    expect(byId.usr_004).toEqual({ userId: 'usr_004', state: 'invited', sentAt: null });
    // Every person of the office, and no agent: an agent signs in through its person.
    expect(output.map((row) => row.userId)).toEqual(['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005', 'usr_006', 'usr_007', 'usr_008', 'usr_010', 'usr_011']);
  });

  it('is for the Admin and Management only', async () => {
    const { ctx } = setup();
    await expect(usersInvites({}, ctx('usr_010'))).resolves.toMatchObject({ changed: false });
    const error = await refusal(usersInvites({}, ctx('usr_002')));
    expect(error.code).toBe('forbidden');
  });
});

describe('users.resendInvite', () => {
  it('writes one auth.invite row in its transaction, runs it after the commit, and gives the time in office time', async () => {
    const { db, ran, resend, ctx } = setup();
    const result = await resend({ id: 'usr_003' }, ctx());
    expect(result.output).toEqual({ sentAt: nowStamp(NOW) });
    expect(result.changed).toBe(false);
    expect(db.tables.outbox).toEqual([{ id: '1', kind: 'auth.invite', payload: { userId: 'usr_003', inviteId: expect.stringMatching(/^inv_/) } }]);
    expect(ran).toEqual([['1']]);
    expect(db.tables.stories[result.storyId!]).toBe('usr_001');
  });

  it('replays the answer of an idempotency key and sends nothing twice; the same key with another input is refused', async () => {
    const { db, ran, resend, ctx, deps } = setup();
    const first = await resend({ id: 'usr_003' }, ctx('usr_001', { key: 'k-1' }));
    deps.clock.advance(60_000);
    const again = await resend({ id: 'usr_003' }, ctx('usr_001', { key: 'k-1', now: deps.clock.now() }));
    expect(again).toEqual(first);
    expect([db.tables.outbox.length, ran.length]).toEqual([1, 1]);
    const reused = await refusal(resend({ id: 'usr_004' }, ctx('usr_001', { key: 'k-1' })));
    expect([reused.code, reused.details.reason]).toEqual(['conflict', 'key_reused']);
  });

  it('maps a story placeholder after the commit, so the next entry of the batch joins the same story', async () => {
    const { db, resend, ctx } = setup();
    const c = ctx();
    const one = await resend({ id: 'usr_003' }, { ...c, story: { ref: 'cor_ui_1' } });
    expect(c.batch.storyRefs.get('cor_ui_1')).toBe(one.storyId);
    const two = await resend({ id: 'usr_004' }, { ...c, story: { ref: 'cor_ui_1' } });
    expect(two.storyId).toBe(one.storyId);
    expect(Object.keys(db.tables.stories)).toEqual([one.storyId]);
  });

  it(`sends at most ${RESEND_PER_DAY} invitations a day to one person; the next is refused and writes nothing`, async () => {
    const { db, ran, resend, ctx } = setup();
    for (let i = 0; i < RESEND_PER_DAY; i += 1) await resend({ id: 'usr_003' }, ctx());
    const error = await refusal(resend({ id: 'usr_003' }, ctx()));
    expect([error.code, error.details.reason]).toEqual(['conflict', 'invite_limit']);
    expect(error.details.retryAfterMs).toBe(18 * 60 * 60 * 1000);
    expect([db.tables.outbox.length, ran.length]).toEqual([RESEND_PER_DAY, RESEND_PER_DAY]);
    // Another person has their own count.
    await expect(resend({ id: 'usr_004' }, ctx())).resolves.toMatchObject({ changed: false });
  });

  it('refuses before any database work: a Member, an unknown person, an agent, a turned-off person, and Management for an Admin', async () => {
    const { db, resend, ctx } = setup();
    const off = snapshotOf({ ...seed, users: { ...seed.users, usr_005: { ...seed.users.usr_005, active: false } } }, 2);
    const cases: [string, unknown, Partial<ServerCallCtx>, string, string | undefined][] = [
      ['usr_002', { id: 'usr_003' }, {}, 'forbidden', undefined],
      ['usr_001', { id: 'usr_404' }, {}, 'not_found', undefined],
      ['usr_001', { id: 'usr_009' }, {}, 'invalid_input', 'invite_agent'],
      ['usr_001', { id: 'usr_005' }, { office: off }, 'invalid_input', 'person_inactive'],
      ['usr_010', { id: 'usr_001' }, {}, 'forbidden', undefined],
    ];
    for (const [userId, input, more, code, reason] of cases) {
      const error = await refusal(resend(input as { id: string }, ctx(userId, more)));
      expect([userId, error.code, error.details.reason]).toEqual([userId, code, reason]);
    }
    expect(db.txs).toBe(0);
  });

  it('keeps its answer when the effect after the commit fails: the job sends it later', async () => {
    const { deps, resend, ctx } = setup({ afterCommit: async () => { throw new Error('Auth is down'); } });
    await expect(resend({ id: 'usr_003' }, ctx())).resolves.toMatchObject({ output: { sentAt: nowStamp(NOW) } });
    expect(deps.logs.some((line) => line.level === 'warn' && line.fields?.error === 'Auth is down')).toBe(true);
  });
});
