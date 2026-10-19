import { describe, expect, it } from 'vitest';
// The mail and push handlers of the outbox: the entries register them through server/core/deps.ts, this test on its own.
import '../../mail/effects';
import '../../push/effects';
import { reviewersOfTask } from '../../../src/api/notify';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { freshLite } from '../../data/lite/testDb';
import { liteWriteState } from '../../data/lite/whole';
import { createRunCall } from '../../core/runCall';
import { liteData } from '../../data/lite/callData';
import { stagingKey, uploadKey } from '../../files/keys';
import { officeSteps, runOfficeJobs } from '../../office/jobs';
import { fakeDeps } from '../../test/fakes/deps';
import { cleanup } from './cleanup';
import { heartbeat } from './heartbeat';
import { outboxRetry } from './outbox';
import { summary } from './summary';
import { triggers } from './triggers';
import { uploads } from './uploads';

const DAY = '2026-10-04';
/** 08:00 Riyadh on a Sunday: after the 07:30 summary, and the reminders of the sample office are due (5 notices). */
const AT = new Date('2026-10-04T05:00:00Z');

async function office(edit: (seed: State) => void = () => undefined) {
  const lite = await freshLite();
  const seed = await buildSeed(DAY, async () => undefined);
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db });
  deps.clock.set(AT);
  return { ...lite, seed, deps };
}

const mailOn = (seed: State) => {
  const prefs = seed.users.usr_002.preferences;
  seed.users.usr_002 = { ...seed.users.usr_002, preferences: { ...prefs, email: { ...prefs.email, due_tomorrow: true, overdue: true } } };
};

describe('the 15-minute job on SQLite (server/jobs/steps)', () => {
  it('writes the heartbeat, and a run that overlaps never moves it back', async () => {
    const { db, deps } = await office();
    await heartbeat(deps, AT);
    await heartbeat(deps, new Date(AT.getTime() - 60_000));
    expect(await db.statement('read', "select done_at from job_runs where key = 'heartbeat'")).toEqual([{ done_at: AT.toISOString() }]);
  });

  it('writes the reminders once, mails the person who takes them, and writes nothing in a second run', async () => {
    const { db, deps } = await office(mailOn);
    const first = await triggers(deps, AT);
    expect(first.notices).toBe(5);
    expect(deps.mail.sent.length).toBeGreaterThan(0);
    expect(deps.mail.sent.every((m) => m.tag === 'notice')).toBe(true);
    const notices = await db.statement('read', 'select count(*) as n from notifications');
    expect(await triggers(deps, AT)).toEqual({ notices: 0, mails: 0 });
    expect(await db.statement('read', 'select count(*) as n from notifications')).toEqual(notices);
  });

  // The reminder of a meeting (fbk_022, owner 2026-10-19): 30 minutes before the start, once for each person and each start.
  it('reminds the people of a meeting that starts within 30 minutes once, and the people of a later meeting in a later run', async () => {
    const meeting = (id: string, startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) => ({
      id, kind: 'meeting' as const, title: `Meeting ${id}`, projectId: null, startsAt, endsAt, where: '', guests: '', notes: '', organizerId: 'usr_003', attendeeIds: ['usr_004'],
      status: 'scheduled' as const, rev: 1, createdBy: 'usr_003', createdAt: '2026-10-03T09:00:00.000+03:00', ...extra,
    });
    const { db, deps } = await office((seed) => {
      seed.meetings = {
        mtg_001: meeting('mtg_001', '2026-10-04T08:20:00.000+03:00', '2026-10-04T09:20:00.000+03:00'),
        mtg_002: meeting('mtg_002', '2026-10-04T08:45:00.000+03:00', '2026-10-04T09:45:00.000+03:00'),
        mtg_003: meeting('mtg_003', '2026-10-04T08:25:00.000+03:00', '2026-10-04T09:25:00.000+03:00', { status: 'cancelled' }),
      };
    });
    const soon = async () => db.statement<{ target_id: string; user_id: string }>('read', "select json_extract(doc, '$.targetId') as target_id, user_id from notifications where json_extract(doc, '$.trigger') = 'meeting_soon' order by id");
    const first = await triggers(deps, AT);
    expect(first.notices).toBe(5 + 2);
    expect(await soon()).toEqual([{ target_id: 'mtg_001', user_id: 'usr_003' }, { target_id: 'mtg_001', user_id: 'usr_004' }]);
    expect(await triggers(deps, AT)).toEqual({ notices: 0, mails: 0 });
    // At 08:20 the second meeting is 25 minutes away, so its people hear it now. Nothing of the first one comes again.
    deps.clock.set(new Date(AT.getTime() + 20 * 60_000));
    const later = await triggers(deps, new Date(AT.getTime() + 20 * 60_000));
    expect(later.notices).toBe(2);
    expect((await soon()).map((row) => row.target_id)).toEqual(['mtg_001', 'mtg_001', 'mtg_002', 'mtg_002']);
    // The reminders send no mail: the email default of both triggers is off, and the producers know the triggers stay in the app.
    expect(deps.mail.sent.filter((m) => /meeting/i.test(JSON.stringify(m)))).toEqual([]);
  });

  // The settle of a meeting that ended (fbk_022, wave 2): the step runs the normal call meetings.settle on the SQLite data.
  it('settles the meetings that ended in the job, with the Tracker line of a project meeting, and settles nothing in a second run', async () => {
    const meeting = (id: string, projectId: string | null, endsAt: string, extra: Record<string, unknown> = {}) => ({
      id, kind: 'client' as const, title: `Review ${id}`, projectId, startsAt: endsAt.replace(/T(\d\d)/, (_m, h: string) => `T${String(Number(h) - 1).padStart(2, '0')}`), endsAt, where: '', guests: '', notes: 'Bring the plans',
      organizerId: 'usr_002', attendeeIds: ['usr_003'], status: 'scheduled' as const, rev: 1, createdBy: 'usr_002', createdAt: '2026-10-03T09:00:00.000+03:00', ...extra,
    });
    const { db, deps } = await office((seed) => {
      seed.meetings = {
        mtg_001: meeting('mtg_001', 'prj_001', '2026-10-04T07:30:00.000+03:00'),
        mtg_002: meeting('mtg_002', null, '2026-10-04T07:00:00.000+03:00'),
        mtg_003: meeting('mtg_003', 'prj_001', '2026-10-04T09:00:00.000+03:00'),
      };
    });
    deps.runCall = createRunCall({ data: liteData });
    const report = await runOfficeJobs(deps, AT);
    expect(report.steps.find((step) => step.name === 'meetings')).toEqual({ name: 'meetings', ok: true, result: { settled: 2, skipped: 0, failed: 0, extended: 0 } });
    const rows = await db.statement<{ id: string; settled_at: string | null }>('read', 'select id, settled_at from meetings order by id');
    expect(rows).toEqual([{ id: 'mtg_001', settled_at: '2026-10-04T08:00:00.000+03:00' }, { id: 'mtg_002', settled_at: '2026-10-04T08:00:00.000+03:00' }, { id: 'mtg_003', settled_at: null }]);
    const lines = await db.statement<{ doc: { meetingId: string; minutes: unknown; title: string; date: string } }>('read', "select doc from tracker where json_extract(doc, '$.auto') = 'meeting'");
    expect(lines.map((line) => [line.doc.meetingId, line.doc.title, line.doc.date, line.doc.minutes])).toEqual([['mtg_001', 'Review mtg_001', '2026-10-04', null]]);
    // The marks and the line came from normal calls: the History holds the mark, and the line names it as its cause.
    const events = await db.statement<{ doc: { verb: string; targetId: string; causeEventId?: string; id: string } }>('read', "select doc from events where json_extract(doc, '$.verb') in ('meeting.settled', 'tracker.logged') and json_extract(doc, '$.createdAt') >= '2026-10-04' order by seq");
    const mark = events.find((row) => row.doc.verb === 'meeting.settled' && row.doc.targetId === 'mtg_001')!;
    expect(events.find((row) => row.doc.verb === 'tracker.logged' && row.doc.causeEventId === mark.doc.id)).toBeDefined();
    // A run that finds nothing writes nothing.
    const again = await runOfficeJobs(deps, AT);
    expect(again.steps.find((step) => step.name === 'meetings')).toMatchObject({ result: { settled: 0 } });
    expect(await db.statement('read', "select id from tracker where json_extract(doc, '$.auto') = 'meeting'")).toHaveLength(1);
  });

  it('sends the morning summary to each person with something to say, marks the day, and sends nothing in a second run', async () => {
    const { seed, deps } = await office();
    // The rule of buildMorning on the State: an open task, past due or due today, that the person leads or helps with, or a review that waits.
    const active = (projectId: string | null) => projectId === null || seed.projects[projectId]?.status === 'active';
    const says = (id: string) => Object.values(seed.tasks).some((t) =>
      (t.dueDate !== null && t.dueDate <= DAY && (t.status === 'todo' || t.status === 'in_progress') && active(t.projectId) && (t.ownerId === id || (t.helperIds ?? []).includes(id)))
      || (t.status === 'in_review' && active(t.projectId) && reviewersOfTask(seed, t).includes(id)));
    const expected = Object.values(seed.users)
      .filter((u) => u.kind === 'human' && u.active && (u.preferences.morningSummary ?? true) && says(u.id))
      .map((u) => `summary-${DAY}-${u.id}`).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(await summary(deps, AT)).toMatchObject({ due: true, day: DAY, sent: expected.length });
    expect(deps.mail.sent.map((m) => m.idempotencyKey).sort()).toEqual(expected);
    expect(await summary(deps, AT)).toEqual({ due: true, day: DAY, done: true });
  });

  it('takes only the outbox rows that are old, open and not claimed', async () => {
    const { db, deps } = await office();
    const old = new Date(AT.getTime() - 10 * 60_000).toISOString();
    await db.statement('write', "insert into outbox (kind, payload, created_at) values ('test.none', '{}', ?1), ('test.none', '{}', ?2)", [old, AT.toISOString()]);
    expect(await outboxRetry(deps)).toEqual({ due: 1, done: 0, failed: 1 });
  });

  it('removes old stories, keys and rate limit windows, and keeps new ones', async () => {
    const { db, deps } = await office();
    const old = new Date(AT.getTime() - 8 * 86_400_000).toISOString();
    await db.statement('write', "insert into stories (id, actor_id, created_at) values ('sty_old', 'usr_001', ?1), ('sty_new', 'usr_001', ?2)", [old, AT.toISOString()]);
    await db.statement('write', "insert into idempotency (actor_id, key, name, digest, result, created_at) values ('usr_001', 'k', 'n', 'd', '{}', ?1)", [old]);
    await db.statement('write', "insert into rate_limits (key, window_start, count) values ('forgot:x', ?1, 1)", [old]);
    expect(await cleanup(deps, AT)).toEqual({ stories: 1, idempotency: 1, officeDeletes: 0, rateLimits: 1, googleRevoking: 0 });
    expect(await db.statement('read', 'select id from stories')).toEqual([{ id: 'sty_new' }]);
  });

  it('removes a revoking Google row after 25 hours, and keeps one of 23 hours and the live rows (fbk_022)', async () => {
    const { db, deps } = await office();
    const hoursAgo = (hours: number) => new Date(AT.getTime() - hours * 3_600_000).toISOString();
    const add = (id: string, user: string, state: string, changed: string) =>
      db.statement('write', 'insert into google_connections (id, user_id, sealed_token, state, connected_at, changed_at) values (?1, ?2, ?3, ?4, ?5, ?5)', [id, user, 'v1.sealed.text', state, changed]);
    await add('old', 'usr_003', 'revoking', hoursAgo(25));
    await add('recent', 'usr_004', 'revoking', hoursAgo(23));
    await add('live', 'usr_005', 'ok', hoursAgo(90));
    expect(await cleanup(deps, AT)).toMatchObject({ googleRevoking: 1 });
    expect(await db.statement('read', 'select id from google_connections order by id')).toEqual([{ id: 'live' }, { id: 'recent' }]);
  });

  it('removes the staging objects of old intents through the files port, and deletes the rows after a day', async () => {
    const { db, deps } = await office();
    const old = new Date(AT.getTime() - 25 * 3_600_000).toISOString();
    const staging = stagingKey('upl_old');
    const final = uploadKey('prj_001', 'upl_old');
    await db.statement('write', 'insert into upload_intents (id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at, used_at, created_at) values (?1, ?2, ?3, ?4, ?5, null, 10, ?6, ?7, null, ?8)',
      ['upl_old', 'usr_001', 'prj_001', staging, final, 'image/png', old, old]);
    expect(await uploads(deps, AT)).toEqual({ intents: 1, removed: 3, deleted: 1 });
    // fakeFiles records one remove with its keys joined: the staging file, its picture, then the copy that no record uses.
    expect(deps.files.calls.filter((c) => c.op === 'remove').map((c) => c.key)).toEqual([[staging, staging.replace(/\/file$/, '/thumb'), final].join(',')]);
  });

  it('runs the usage step in the first run of each hour only', () => {
    expect(officeSteps(new Date('2026-10-04T05:00:00Z')).map((s) => s.name)).toContain('usage');
    expect(officeSteps(new Date('2026-10-04T05:15:00Z')).map((s) => s.name)).not.toContain('usage');
  });

  it('runs the cleanup of the old sign-in rows in the first run after 00:00 UTC only (exit waves 2 and 3)', () => {
    const names = (at: string) => officeSteps(new Date(at)).map((s) => s.name);
    expect(names('2026-10-04T00:00:00Z')).toContain('signin');
    expect(names('2026-10-04T00:14:59Z')).toContain('signin');
    expect(names('2026-10-04T00:15:00Z')).not.toContain('signin');
    expect(names('2026-10-04T05:00:00Z')).not.toContain('signin');
    expect(names('2026-10-03T23:45:00Z')).not.toContain('signin');
  });

  it('deletes the sign-in rows that ended more than a day ago in that run, and keeps the others', async () => {
    const { raw, deps } = await office();
    const at = new Date('2026-10-04T00:00:00Z');
    deps.clock.set(at);
    raw.prepare("insert into auth_links (token_hash, auth_id, type, expires_at) values ('old', 'a1', 'invite', '2026-10-02T00:00:00.000Z'), ('new', 'a1', 'invite', '2026-10-03T12:00:00.000Z')").run();
    const report = await runOfficeJobs(deps, at);
    expect(report.steps.find((step) => step.name === 'signin')).toMatchObject({ ok: true });
    expect(raw.prepare('select token_hash from auth_links').all()).toEqual([{ token_hash: 'new' }]);
  });
});
