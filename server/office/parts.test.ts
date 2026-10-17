import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { WireResponse } from '../../src/api/remote/wire';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { resolveActor } from '../core/actor';
import { everyCall } from '../core/everyCall';
import { nodeHost } from '../data/lite/host';
import { liteSave } from '../data/lite/save';
import { applyLiteSchema, LITE_SCHEMA_VERSION } from '../data/lite/schema';
import { liteWriteState } from '../data/lite/whole';
import { fixedClock } from '../test/fakes/clock';
import { CLOSE_OFF, CLOSE_STALE } from './live';
import { EffectLedger, type OfficeBatchInput } from './batch';
import { officeParts } from './parts';
import { fakeSockets, openFor, recordingNet } from './test/fakes';

const TODAY = '2026-10-04';
const NOW = '2026-10-04T06:00:00.000Z';
/** The values of a Worker on the office path, none of them a secret (the tests reach no network). */
export const OFFICE_ENV: Record<string, string> = {
  APP_URL: 'http://127.0.0.1:5173', MAIL_FROM: 'Madar <notices@madar.test>', MAIL_DRIVER: 'resend', RESEND_API_KEY: 're_test_not_a_key',
  SUPABASE_URL: 'http://127.0.0.1:54321', MADAR_SECRET_KEY: 'sb_secret_test_not_a_key', MADAR_FILE_STORE: 'r2', R2_ACCOUNT_ID: '0'.repeat(32),
  R2_ACCESS_KEY_ID: 'test-not-a-key', R2_SECRET_ACCESS_KEY: 'test-not-a-key', R2_BUCKET: 'madar-files-test',
};
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** The office parts on node:sqlite with the sample office. The token of a batch is the user id itself, as in test:office. */
async function office(edit: (seed: State) => void = () => undefined) {
  const raw = new DatabaseSync(':memory:');
  const host = Object.assign(nodeHost(raw), { totals: { rowsRead: 0, rowsWritten: 0 } });
  await applyLiteSchema(host);
  const sockets = fakeSockets();
  const parts = officeParts({
    host, read: (name) => OFFICE_ENV[name], sockets, clock: fixedClock(NOW), log: silent,
    principal: (who, snapshot) => {
      const principal = { userId: who.authUserId };
      resolveActor(snapshot, principal);
      return principal;
    },
  });
  const seed = await buildSeed(TODAY, async () => undefined);
  edit(seed);
  await parts.db.tx('write', (q) => liteWriteState(q, seed));
  const net = recordingNet();
  const batch = async (userId: string, calls: Omit<OfficeBatchInput['calls'][number], 'i'>[]) => {
    const out = await parts.batch({ who: { kind: 'browser', authUserId: userId }, calls: calls.map((c, i) => ({ i, ...c })), overviewCalls: 0, worker: 1 }, net);
    return out.ok ? { ...out, answer: JSON.parse(out.body) as WireResponse } : out;
  };
  return { raw, parts, sockets, seed, net, batch };
}

const ok = <T,>(result: { ok: true; answer: WireResponse; later: string[] } | { ok: false }): { answer: WireResponse; later: string[] } => {
  if (!result.ok) throw new Error('The batch was refused.');
  return result;
};

describe('the office parts (server/office/parts.ts)', () => {
  it('answers a batch in the order sent, so a read after a write sees the write', async () => {
    const { seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const id = (move.input as { id: string }).id;
    const { answer } = ok(await batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'tasks.get', input: { id } }]));
    expect(answer.results.map((r) => [r.i, r.ok])).toEqual([[0, true], [1, true]]);
    expect((answer.results[1] as { output: { task: { status: string } } }).output.task.status).toBe('in_progress');
  });

  it('refuses the whole batch for a person who is off, before any call', async () => {
    const { raw, batch } = await office((seed) => {
      seed.users.usr_004 = { ...seed.users.usr_004, active: false };
    });
    const before = raw.prepare('select count(*) as n from stories').get();
    const out = await batch('usr_004', [{ name: 'story.start', input: {} }]);
    expect(out).toMatchObject({ ok: false, error: { code: 'unauthenticated', details: { reason: 'account_off' } } });
    expect(raw.prepare('select count(*) as n from stories').get()).toEqual(before);
  });

  it('maps a story ref of one entry to the next entry of the batch', async () => {
    const { seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const arrange = everyCall(seed).find((c) => c.name === 'tasks.arrange')!;
    const { answer } = ok(await batch(move.actorId, [
      { name: move.name, input: move.input, story: { ref: 'r1' } },
      { name: arrange.name, input: arrange.input, story: { ref: 'r1' } },
    ]));
    const [a, b] = answer.results as { storyId?: string }[];
    expect(a.storyId).toBeDefined();
    expect(b.storyId).toBe(a.storyId);
  });

  it('replays a write with the same key and writes nothing the second time', async () => {
    const { raw, seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const first = ok(await batch(move.actorId, [{ name: move.name, input: move.input, key: 'k1' }])).answer;
    const events = raw.prepare('select count(*) as n from events').get();
    const second = ok(await batch(move.actorId, [{ name: move.name, input: move.input, key: 'k1' }])).answer;
    expect(second.results).toEqual(first.results);
    expect(raw.prepare('select count(*) as n from events').get()).toEqual(events);
  });

  it('keeps the mail of a new task for after the answer', async () => {
    const { raw, batch } = await office((seed) => {
      const prefs = seed.users.usr_003.preferences;
      seed.users.usr_003 = { ...seed.users.usr_003, preferences: { ...prefs, email: { ...prefs.email, task_assigned: true } } };
    });
    const { answer, later } = ok(await batch('usr_001', [{
      name: 'tasks.create', input: { projectId: 'prj_001', title: 'Site photos', ownerId: 'usr_003', description: '', flagged: false },
    }]));
    expect(answer.results[0].ok).toBe(true);
    const rows = later.map((id) => raw.prepare('select kind, done_at, payload from outbox where id = ?').get(Number(id)) as { kind: string; done_at: null; payload: string });
    // The mail of usr_003 waits for after the answer, undone; every row of later is a mail or a push.
    expect(rows.some((row) => row.kind === 'mail.notice')).toBe(true);
    for (const row of rows) expect([['mail.notice', 'push.notify'].includes(row.kind), row.done_at]).toEqual([true, null]);
  });

  it('gives the network call of a file link to the Worker port', async () => {
    const { net, batch } = await office();
    const { answer } = ok(await batch('usr_001', [{ name: 'files.link', input: { id: 'fil_001', variant: 'full', disposition: 'inline' } }]));
    expect(answer.results[0]).toMatchObject({ ok: true, output: { url: 'https://files.test/get/blob_seed_001' } });
    expect(net.calls).toEqual(['presignGet blob_seed_001']);
  });

  it('adds the counts of the batch to the day row in its write', async () => {
    const { raw, seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    ok(await batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'session.get', input: {} }]));
    expect(raw.prepare('select requests, calls, worker_requests from usage_day where day = ?').get(TODAY)).toEqual({ requests: 1, calls: 2, worker_requests: 1 });
  });

  it('closes the sockets of a person whom the batch turned off', async () => {
    const { sockets, batch } = await office();
    const socket = openFor(sockets, 'usr_007', Date.parse(NOW));
    ok(await batch('usr_001', [{ name: 'users.deactivate', input: { id: 'usr_007' } }]));
    expect(socket.closed?.code).toBe(CLOSE_OFF);
  });

  it('runs the invitation of a new person in the object: the sign-in row, its link, and the mail through the Worker port', async () => {
    const { raw, net, batch } = await office();
    const { answer } = ok(await batch('usr_001', [{
      name: 'users.create', input: { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' },
    }]));
    expect(answer.results[0].ok).toBe(true);
    expect(raw.prepare("select count(*) as n from outbox where kind = 'auth.invite' and done_at is not null and error is null").get()).toEqual({ n: 1 });
    expect(raw.prepare('select email, email_confirmed from auth_users').all()).toEqual([{ email: 'new.person@madar.test', email_confirmed: 0 }]);
    expect(raw.prepare('select type from auth_links where used_at is null').all()).toEqual([{ type: 'invite' }]);
    expect(net.calls.filter((call) => call.startsWith('mail '))).toHaveLength(1);
  });

  it('opens a socket for a ticket that it made, with the tags of the person', async () => {
    const { parts, sockets } = await office();
    const { ticket } = parts.tickets.mint('usr_005', new Date(NOW));
    const answer = await parts.socket(new Request(`https://office.internal/live?ticket=${ticket}`, { headers: { upgrade: 'websocket' } }));
    expect(answer.status).toBe(101);
    expect(sockets.all.map((one) => one.tags)).toEqual([['office', 'person:usr_005']]);
  });

  it('runs the job steps on a Cron call, adds the meter counts, and closes a stale socket', async () => {
    const { parts, sockets, raw, net } = await office();
    const stale = openFor(sockets, 'usr_002', Date.parse(NOW) - 10 * 60_000);
    const report = await parts.cron({ at: NOW, worker: 2 }, net);
    expect(report.steps.map((s) => s.name)).toEqual(['heartbeat', 'triggers', 'summary', 'outbox', 'cleanup', 'uploads', 'usage']);
    // The reminders of the run send signals, and each delivery sweeps first: that sweep or the one of the Cron closes the socket.
    expect(stale.closed?.code).toBe(CLOSE_STALE);
    expect(raw.prepare("select done_at from job_runs where key = 'heartbeat'").get()).toEqual({ done_at: NOW });
    expect(report.day).toMatchObject({ requests: 1, worker_requests: 2 });
  });

  it('warns the Admins in a Cron run when a day meter reaches 80%', async () => {
    const { parts, raw, net } = await office();
    raw.prepare("insert into usage_day (day, rows_read) values ('2026-10-04', 4500000)").run();
    await parts.cron({ at: NOW, worker: 0 }, net);
    expect(net.calls).toContain('mail limit-warning-2026-10-04-rowsReadDay-usr_001');
  });

  it('answers health with the schema version and the last job run', async () => {
    const { parts } = await office();
    expect(await parts.health()).toEqual({ schema: LITE_SCHEMA_VERSION, lastJob: null });
  });
});

describe('the effect ledger of a batch', () => {
  it('runs the other kinds before the answer and the mails and pushes after it, and drops a row that did not commit', () => {
    const ledger = new EffectLedger();
    ledger.wrote(['1', '2', '3', '4'], ['r2.delete', 'mail.notice', 'push.notify', 'mail.notice']);
    ledger.committed(['1', '2', '3']);
    expect(ledger.split()).toEqual({ now: ['1'], later: ['2', '3'] });
  });
});
