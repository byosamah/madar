import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Notification, Project, Task, User } from '../../src/api/contract/entities';
import { runScheduledTriggers } from '../../src/api/notify';
import { registerEffect } from '../core/effects';
import type { FilesPort } from '../core/ports';
import { clearOfficeCaches } from '../data/officeCache';
import { supabaseStorageFilesPort } from '../files/supabaseStorage';
import { NOTICE_EFFECT } from '../mail/notices';
import { buildMorning, summaryPeople } from '../mail/summary';
// The entries load the mail effects for their side effect (server/core/deps.ts); this suite does the same.
import '../mail/effects';
import { JOBS_SECRET_HEADER, jobsApp } from '../jobs/app';
import { cleanup } from '../jobs/steps/cleanup';
import { outboxRetry } from '../jobs/steps/outbox';
import { summary } from '../jobs/steps/summary';
import { triggers } from '../jobs/steps/triggers';
import { uploads } from '../jobs/steps/uploads';
import { NOW, startOffice, type ItOffice } from './runCallOffice';

/**
 * Suite 10 of TM 7, the 15-minute job on the local stack (plan 5.5; task N3.1) [Docker]: each step as madar_server on its own
 * office schema, the upload step against the local Supabase Storage, and POST /jobs/run end to end. The steps never trust the
 * clock of the database for their limits: each takes the time of the run, so the tests move it.
 * server/jobs/**\/*.test.ts check the same rules in memory.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** 06:00 UTC is 09:00 in Riyadh. */
const at = (day: string) => new Date(`${day}T06:00:00Z`);

let office: ItOffice;
let deps: ReturnType<ItOffice['isolate']>;

type NoticeRow = { id: string; user_id: string; trigger: string; target_id: string; dedupe_key: string | null };
const notices = () =>
  office.sql<NoticeRow>("select id, user_id, doc->>'trigger' as trigger, doc->>'targetId' as target_id, dedupe_key from notifications order by ord");

/** One field of a record's doc, as postgres. A change to an office table also clears the office caches, so the next read sees it. */
async function setDoc(table: 'tasks' | 'users' | 'projects', id: string, path: string[], value: unknown): Promise<void> {
  await office.sql(`update ${table} set doc = jsonb_set(doc, $2::text[], $3::jsonb, true) where id = $1`, [id, path, JSON.stringify(value)]);
  if (table !== 'tasks') clearOfficeCaches();
}

beforeAll(async () => {
  office = await startOffice('n3jobs');
  deps = office.isolate();
}, 60_000);

afterAll(async () => {
  await office?.close();
});

describe('suite 10: the 15-minute job on the local database, as madar_server', () => {
  /** An open task of an active project with an active leader, whose people get notices. */
  let project: Project;
  let tasks: Task[];

  beforeAll(() => {
    const seed = office.seed;
    project = Object.values(seed.projects).find((p) => p.status === 'active' && p.leaderId && seed.users[p.leaderId]?.active)!;
    tasks = Object.values(seed.tasks).filter((t) => t.projectId === project.id && (t.status === 'todo' || t.status === 'in_progress') && seed.users[t.ownerId ?? '']?.active);
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });

  it('runs the scheduled triggers through the database with the notices of the prototype, and a second run writes nothing new', async () => {
    const expected = structuredClone(office.seed);
    const count = runScheduledTriggers(expected, NOW);
    const made = Object.values(expected.notifications).filter((n) => !office.seed.notifications[n.id]);
    expect(made).toHaveLength(count);
    expect(count).toBeGreaterThan(0);

    deps.signal.sent.length = 0;
    expect(await triggers(deps, NOW)).toEqual({ notices: count, mails: expect.any(Number) });
    const rows = (await office.sql<{ id: string; doc: Notification }>('select id, doc from notifications order by ord')).filter((n) => !office.seed.notifications[n.id]);
    // The whole record, as the prototype writes it: the due day (API-11), the time, the actor and the read flag too.
    expect(rows.map((n) => n.doc)).toEqual(made);
    // Notices are personal: one signal on each person channel, none on the office channel.
    expect(deps.signal.sent.length).toBeGreaterThan(0);
    expect(deps.signal.sent.every((s) => s.channel.startsWith('person:') && s.kinds.includes('notifications'))).toBe(true);

    expect(await triggers(deps, new Date(NOW.getTime() + 15 * 60_000))).toEqual({ notices: 0, mails: 0 });
    expect((await notices()).length).toBe(Object.keys(office.seed.notifications).length + count);
  });

  it('names a task due on Sunday on the Thursday before, and tells the leader of a paused project on its restart day (API-11, API-18)', async () => {
    const task = tasks[0];
    await setDoc('tasks', task.id, ['dueDate'], '2026-11-01'); // a Sunday
    const paused = Object.values(office.seed.projects).find((p) => p.id !== project.id && p.status === 'active' && p.leaderId && office.seed.users[p.leaderId]?.active)!;
    await setDoc('projects', paused.id, ['status'], 'on_hold');
    await setDoc('projects', paused.id, ['pause'], { reason: 'Client', resumeOn: '2026-10-29', by: paused.leaderId, at: '2026-10-20T09:00:00.000+03:00' });
    const of = async (target: string, trigger: string) => (await notices()).filter((n) => n.target_id === target && n.trigger === trigger);

    await triggers(deps, at('2026-10-28')); // Wednesday
    expect(await of(task.id, 'due_tomorrow')).toEqual([]);
    expect(await of(paused.id, 'resume_due')).toEqual([]);
    await triggers(deps, at('2026-10-29')); // Thursday
    const due = await of(task.id, 'due_tomorrow');
    expect(due.length).toBeGreaterThan(0);
    expect(due.every((n) => n.dedupe_key === `due_tomorrow:${task.id}:2026-11-01:${n.user_id}`)).toBe(true);
    expect((await of(paused.id, 'resume_due')).map((n) => n.user_id)).toEqual([paused.leaderId]);
    await triggers(deps, at('2026-10-31')); // Saturday: already sent
    expect(await of(task.id, 'due_tomorrow')).toHaveLength(due.length);
    expect(await of(paused.id, 'resume_due')).toHaveLength(1);
  });

  it('tells the active Admins of the restart day when the leader of the paused project is inactive (notifyAudit, API-18)', async () => {
    const leaders = new Set([project.leaderId, ...tasks.map((t) => t.ownerId)]);
    // The paused project of the test above may come back here: its restart day differs, so the dedupe key tells the notices apart.
    const paused = Object.values(office.seed.projects).find(
      (p) => p.status === 'active' && p.leaderId && !leaders.has(p.leaderId) && office.seed.users[p.leaderId]?.active && office.seed.users[p.leaderId].systemRole !== 'admin',
    )!;
    expect(paused).toBeDefined();
    const admins = Object.values(office.seed.users).filter((u) => u.systemRole === 'admin' && u.active).map((u) => u.id).sort();
    expect(admins.length).toBeGreaterThan(0);
    await setDoc('projects', paused.id, ['status'], 'on_hold');
    await setDoc('projects', paused.id, ['pause'], { reason: 'Client', resumeOn: '2026-10-31', by: paused.leaderId, at: '2026-10-20T09:00:00.000+03:00' });
    await setDoc('users', paused.leaderId!, ['active'], false);
    try {
      // The same moment as the last run above, so only this restart notice is new.
      expect(await triggers(deps, at('2026-10-31'))).toMatchObject({ notices: admins.length });
      const rows = (await notices()).filter((n) => n.dedupe_key?.startsWith(`resume_due:${paused.id}:2026-10-31:`));
      expect(rows.map((n) => n.user_id).sort()).toEqual(admins);
    } finally {
      await setDoc('users', paused.leaderId!, ['active'], true);
    }
  });

  it('writes one mail.notice row for a person whose email switch of the trigger is on, and the mail goes out once', async () => {
    const task = tasks[1];
    const owner = task.ownerId!;
    await setDoc('tasks', task.id, ['dueDate'], '2026-11-18');
    await setDoc('users', owner, ['preferences', 'email'], { ...office.seed.users[owner].preferences.email, overdue: true });
    deps.mail.sent.length = 0;
    await triggers(deps, at('2026-11-22'));
    const [notice] = (await notices()).filter((n) => n.dedupe_key === `overdue:${task.id}:2026-11-18:${owner}`);
    expect(notice).toBeDefined();
    const rows = await office.sql<{ payload: { notificationId: string }; done: boolean }>(
      'select payload, done_at is not null as done from outbox where kind = $1 and payload->>\'notificationId\' = $2', [NOTICE_EFFECT, notice.id],
    );
    expect(rows).toEqual([{ payload: { notificationId: notice.id }, done: true }]);
    expect(deps.mail.sent.filter((m) => m.idempotencyKey === `notice-${notice.id}`).map((m) => [m.to, m.tag])).toEqual([[office.seed.users[owner].email, 'notice']]);
    await triggers(deps, at('2026-11-22'));
    expect(deps.mail.sent.filter((m) => m.idempotencyKey === `notice-${notice.id}`)).toHaveLength(1);
  });

  it('gives two runs at the same moment the same notices as one run, with no repeat (the office lock and the dedupe index)', async () => {
    const other = office.isolate();
    await setDoc('tasks', tasks[2].id, ['dueDate'], '2026-12-01');
    const before = (await notices()).length;
    const [a, b] = await Promise.all([triggers(deps, at('2026-12-03')), triggers(other, at('2026-12-03'))]);
    const after = await notices();
    expect(after.length - before).toBe(a.notices + b.notices);
    expect(a.notices + b.notices).toBeGreaterThan(0);
    expect(Math.min(a.notices, b.notices)).toBe(0);
    const keys = after.map((n) => n.dedupe_key).filter((k) => k !== null);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sends the morning summary once at 07:30 Riyadh on a working day, also to a person with no morningSummary field, and never on Friday', async () => {
    const day = '2026-10-04'; // Sunday
    const people = await deps.db.tx('read', (q) => summaryPeople(q));
    const withNews: User[] = [];
    for (const id of people) if (await deps.db.tx('read', (q) => buildMorning(q, { id }, day))) withNews.push(office.seed.users[id]);
    expect(withNews.length).toBeGreaterThanOrEqual(2);
    const [unset, off] = withNews;
    await office.sql("update users set doc = doc #- '{preferences,morningSummary}' where id = $1", [unset.id]);
    await setDoc('users', off.id, ['preferences', 'morningSummary'], false);
    const wanted = withNews.filter((u) => u.id !== off.id).map((u) => `summary-${day}-${u.id}`);
    deps.mail.sent.length = 0;

    expect(await summary(deps, new Date(`${day}T04:29:00Z`))).toEqual({ due: false });
    expect(await summary(deps, at('2026-10-09'))).toEqual({ due: false }); // Friday
    expect(deps.mail.sent).toEqual([]);

    deps.clock.set(`${day}T04:30:00Z`);
    const first = await summary(deps, new Date(`${day}T04:30:00Z`));
    expect(first).toMatchObject({ due: true, day, sent: wanted.length, already: 0 });
    expect(deps.mail.sent.map((m) => m.idempotencyKey).sort()).toEqual([...wanted].sort());
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toContain(`summary-${day}-${unset.id}`);
    expect(await office.sql('select key from job_runs where key = $1', [`summary:${day}`])).toEqual([{ key: `summary:${day}` }]);
    expect(await summary(deps, new Date(`${day}T04:45:00Z`))).toEqual({ due: true, day, done: true });
    expect(deps.mail.sent).toHaveLength(wanted.length);
    deps.clock.set(NOW);
  });

  it('retries the open outbox rows older than 2 minutes with fewer than 5 attempts, and leaves the others', async () => {
    const ran: string[] = [];
    const undo = registerEffect('test.jobs', async (payload) => {
      ran.push(String(payload.name));
    });
    try {
      await office.sql(`insert into outbox (kind, payload, attempts, error, created_at, claimed_until) values
        ('test.jobs', '{"name":"due"}', 1, 'down', now() - interval '5 minutes', now() - interval '3 minutes'),
        ('test.jobs', '{"name":"spent"}', 5, 'down', now() - interval '5 minutes', null),
        ('test.jobs', '{"name":"fresh"}', 0, null, now(), null),
        ('test.jobs', '{"name":"claimed"}', 1, null, now() - interval '5 minutes', now() + interval '1 minute')`);
      const result = await outboxRetry(deps);
      expect(ran).toEqual(['due']);
      expect(result.done).toBeGreaterThanOrEqual(1);
      const rows = await office.sql<{ name: string; done: boolean; attempts: number }>(
        "select payload->>'name' as name, done_at is not null as done, attempts from outbox where kind = 'test.jobs' order by id",
      );
      expect(rows).toEqual([
        { name: 'due', done: true, attempts: 2 },
        { name: 'spent', done: false, attempts: 5 },
        { name: 'fresh', done: false, attempts: 0 },
        { name: 'claimed', done: false, attempts: 1 },
      ]);
    } finally {
      undo();
    }
  });

  it('deletes stories after 7 days, idempotency keys after 24 hours, office_deletes after 7 days, rate limit windows after 1 day and revoking Google rows after 1 day', async () => {
    const t = (ms: number) => new Date(NOW.getTime() - ms);
    await office.sql(
      "insert into google_connections (id, user_id, state, connected_at, changed_at) values ('gc-old-n3', 'usr_001', 'revoking', $1, $1), ('gc-new-n3', 'usr_002', 'revoking', $2, $2), ('gc-live-n3', 'usr_003', 'ok', $1, $1)",
      [t(DAY + HOUR), t(DAY - HOUR)],
    );
    await office.sql('insert into stories (id, actor_id, created_at) values ($1, $3, $4), ($2, $3, $5)', ['sty_old_n3', 'sty_new_n3', 'usr_001', t(7 * DAY + HOUR), t(7 * DAY - HOUR)]);
    await office.sql(
      "insert into idempotency (actor_id, key, name, digest, result, created_at) values ('usr_001', 'old-n3', 'x', 'd', '{}', $1), ('usr_001', 'new-n3', 'x', 'd', '{}', $2)",
      [t(DAY + HOUR), t(DAY - HOUR)],
    );
    await office.sql("insert into office_deletes (tbl, id, chg, created_at) values ('clients', 'old-n3', 0, $1), ('clients', 'new-n3', 0, $2)", [t(7 * DAY + HOUR), t(7 * DAY - HOUR)]);
    await office.sql("insert into rate_limits (key, window_start, count) values ('old-n3', $1, 1), ('new-n3', $2, 1)", [t(DAY + HOUR), t(DAY - HOUR)]);
    const result = await cleanup(deps, NOW);
    expect(result).toMatchObject({ stories: expect.any(Number), idempotency: expect.any(Number) });
    expect(Object.values(result).every((n) => n >= 1)).toBe(true);
    expect(await office.sql("select id from stories where id like '%_n3'")).toEqual([{ id: 'sty_new_n3' }]);
    expect(await office.sql("select key from idempotency where key like '%-n3'")).toEqual([{ key: 'new-n3' }]);
    expect(await office.sql("select id from office_deletes where id like '%-n3'")).toEqual([{ id: 'new-n3' }]);
    expect(await office.sql("select key from rate_limits where key like '%-n3'")).toEqual([{ key: 'new-n3' }]);
    expect(await office.sql("select id from google_connections where id like '%-n3' order by id")).toEqual([{ id: 'gc-live-n3' }, { id: 'gc-new-n3' }]);
  });

  it('answers POST /jobs/run with the secret: 200, every step passed, and the heartbeat moved', async () => {
    const friday = at('2026-11-27');
    deps.clock.set(friday);
    const app = jobsApp(deps, { secret: () => 'local-jobs-secret-made-up' });
    expect((await app.fetch(new Request('http://127.0.0.1/run', { method: 'POST' }))).status).toBe(401);
    const response = await app.fetch(new Request('http://127.0.0.1/run', { method: 'POST', headers: { [JOBS_SECRET_HEADER]: 'local-jobs-secret-made-up' } }));
    const body = (await response.json()) as { ok: boolean; steps: { name: string; ok: boolean; error?: string }[] };
    expect(body.steps.filter((s) => !s.ok)).toEqual([]);
    expect(response.status).toBe(200);
    expect(body.steps.map((s) => s.name)).toEqual(['heartbeat', 'triggers', 'meetings', 'summary', 'outbox', 'cleanup', 'uploads']);
    const [beat] = await office.sql<{ done_at: Date }>("select done_at from job_runs where key = 'heartbeat'");
    expect(beat.done_at.toISOString()).toBe(friday.toISOString());
    deps.clock.set(NOW);
  });
});

describe('suite 10: the upload leftovers on the local Supabase Storage (proof.md, Z0a item 6)', () => {
  let store: FilesPort;
  let fdeps: ReturnType<ItOffice['isolate']>;
  const keysOf = (n: string) => ({ staging: `up/upl-n3${n}/file`, stagingThumb: `up/upl-n3${n}/thumb`, final: `prj-n3/upl-n3${n}/file` });

  beforeAll(() => {
    const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>;
    store = supabaseStorageFilesPort({ supabaseUrl: 'http://127.0.0.1:54321', secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, bucket: 'madar-files' });
    fdeps = office.isolate();
    fdeps.files = store as never;
  }, 60_000);

  async function put(key: string): Promise<void> {
    const body = new TextEncoder().encode(`object ${key}`);
    const signed = await store.presignPut(key, { mimeType: 'text/plain', size: body.byteLength });
    const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
    expect(response.status, key).toBe(200);
  }

  it('deletes every up/ object older than 2 hours 10 minutes for used and unused intents, the copy of an unused intent past its end, and the rows 24 hours after their use', async () => {
    const intents = [
      { n: 'used', used: true, age: 3 * HOUR },
      { n: 'unused', used: false, age: 3 * HOUR },
      { n: 'young', used: false, age: HOUR },
      { n: 'day', used: true, age: 25 * HOUR },
      // Used 23 hours ago: the stored answer of its call is still there, so the row stays.
      { n: 'late', used: true, age: 25 * HOUR, usedAge: 23 * HOUR },
    ];
    for (const i of intents) {
      const k = keysOf(i.n);
      const created = new Date(NOW.getTime() - i.age);
      await office.sql(
        'insert into upload_intents (id, actor_id, project_id, staging_key, key, thumb_key, size, mime_type, expires_at, used_at, created_at) '
        + "values ($1, 'usr_001', 'prj_n3', $2, $3, null, 10, 'text/plain', $4, $5, $6)",
        [`upl_n3${i.n}`, k.staging, k.final, new Date(created.getTime() + 2 * HOUR), i.used ? (i.usedAge ? new Date(NOW.getTime() - i.usedAge) : new Date(created.getTime() + 60_000)) : null, created],
      );
      for (const key of [k.staging, k.stagingThumb, k.final]) await put(key);
    }
    try {
      expect(await uploads(fdeps, NOW)).toEqual({ intents: 4, removed: 9, deleted: 1 });
      const left = async (key: string) => (await store.head(key)) !== null;
      for (const n of ['used', 'unused', 'day', 'late']) {
        expect(await left(keysOf(n).staging), n).toBe(false);
        expect(await left(keysOf(n).stagingThumb), n).toBe(false);
      }
      expect(await left(keysOf('young').staging)).toBe(true);
      expect(await left(keysOf('unused').final)).toBe(false);
      expect(await left(keysOf('used').final)).toBe(true);
      expect(await left(keysOf('day').final)).toBe(true);
      expect((await office.sql<{ id: string }>("select id from upload_intents where id like 'upl_n3%' order by id")).map((r) => r.id)).toEqual(['upl_n3late', 'upl_n3unused', 'upl_n3used', 'upl_n3young']);
    } finally {
      await store.remove(intents.flatMap((i) => Object.values(keysOf(i.n))));
    }
  });
});
