import { describe, expect, it } from 'vitest';
// The mail and push handlers of the outbox: the entries register them through server/core/deps.ts, this test on its own.
import '../../mail/effects';
import '../../push/effects';
import { reviewersOfTask } from '../../../src/api/notify';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { freshLite } from '../../data/lite/testDb';
import { liteWriteState } from '../../data/lite/whole';
import { stagingKey, uploadKey } from '../../files/keys';
import { officeSteps } from '../../office/jobs';
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

  it('sends the morning summary to each person with something to say, marks the day, and sends nothing in a second run', async () => {
    const { seed, deps } = await office();
    // The rule of SUMMARY_COUNTS_SQL on the State: a task due today that the person leads or helps with, or a review that waits.
    const active = (projectId: string | null) => projectId === null || seed.projects[projectId]?.status === 'active';
    const says = (id: string) => Object.values(seed.tasks).some((t) =>
      (t.dueDate === DAY && (t.status === 'todo' || t.status === 'in_progress') && active(t.projectId) && (t.ownerId === id || (t.helperIds ?? []).includes(id)))
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
    expect(await cleanup(deps, AT)).toEqual({ stories: 1, idempotency: 1, officeDeletes: 0, rateLimits: 1 });
    expect(await db.statement('read', 'select id from stories')).toEqual([{ id: 'sty_new' }]);
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
});
