import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Project, Task, User } from '../../src/api/contract/entities';
import { morningSummaryOn, reviewersOf } from '../../src/api/notify';
import type { State } from '../../src/api/store';
import { peopleOfTask } from '../../src/lib/taskPeople';
import { processOutbox } from '../core/effects';
import { runCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { NOTICE_EFFECT, QUOTA_WARNING_EFFECT, sendNoticeMail } from '../mail/notices';
// The outbox driver loads the mail effects for its side effect, as server/core/deps.ts does for the entries.
import { outboxMailPort } from '../mail/outboxDriver';
import { buildSummary, sendSummary, summaryPeople } from '../mail/summary';
import { NOW, TODAY, newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * Suite 9 of TM 7, the notice mail on the local database (plan 5.4; task N2.2): runCall writes the mail.notice row in the call's
 * transaction, the effect sends once after the commit through the outbox driver (MAIL_DRIVER=outbox, so no mail leaves the Mac),
 * and a second run of the same effect sends nothing new. It also checks the summary SQL against the rules of the screens.
 * It needs the local stack and the Docker lock.
 */

const SECRET_TITLE = 'Confidential facade study for the tower';

type Live = ReturnType<ItOffice['isolate']>;

function okOf<T>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

describe('suite 9: the notice mail on the local database, as madar_server', () => {
  let office: ItOffice;
  let deps: Live;
  let leader: string;
  let project: Project;
  /** Active people of the project who are not its leader: each test gives tasks to one of them. */
  let members: User[];

  const live = (): Live => {
    const isolate = office.isolate();
    // The outbox driver keeps the Resend rules for the idempotency key, so a second send of one key adds no row.
    return Object.assign(isolate, { mail: outboxMailPort(isolate.db) as unknown as Live['mail'], config: { ...isolate.config, appUrl: 'https://madar.test' } });
  };
  const call = (as: string, name: string, input: unknown, d: Live = deps) => runCall(d, { principal: { userId: as }, name, input, batch: newBatch() });
  const assign = async (ownerId: string, title = SECRET_TITLE) =>
    okOf<{ task: { id: string } }>(await call(leader, 'tasks.create', { projectId: project.id, title, ownerId })).task.id;
  const noticeOf = async (taskId: string, userId: string) =>
    (await office.sql<{ id: string }>("select id from notifications where target_id = $1 and user_id = $2 and doc->>'trigger' = 'task_assigned'", [taskId, userId]))[0]?.id;
  const mails = () => office.sql<{ to_email: string; tag: string; idempotency_key: string; mail: { html: string; text: string; subject: string } }>(
    'select to_email, tag, idempotency_key, mail from mail_outbox order by id',
  );
  const outboxOf = (kind: string) => office.sql<{ id: string; payload: Record<string, unknown>; done: boolean; attempts: number }>(
    'select id::text as id, payload, done_at is not null as done, attempts from outbox where kind = $1 order by id', [kind],
  );

  beforeAll(async () => {
    office = await startOffice('email');
    deps = live();
    const seed = office.seed;
    project = Object.values(seed.projects).find((p) => p.status === 'active' && p.leaderId && seed.users[p.leaderId]?.active)!;
    leader = project.leaderId!;
    const ids = new Set(Object.values(seed.members).filter((m) => m.projectId === project.id).map((m) => m.userId));
    members = [...ids].map((id) => seed.users[id]).filter((u) => u && u.id !== leader && u.active && u.kind === 'human');
    expect(members.length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  beforeEach(async () => {
    await office.sql('truncate mail_log, mail_outbox, outbox');
  });

  afterAll(async () => {
    await office?.close();
  });

  it('writes the mail.notice row in the call and sends one mail after the commit, with no client data', async () => {
    const [sara] = members;
    const taskId = await assign(sara.id);
    const noticeId = await noticeOf(taskId, sara.id);
    expect(noticeId).toBeTruthy();
    expect(await outboxOf(NOTICE_EFFECT)).toEqual([{ id: expect.any(String), payload: { notificationId: noticeId }, done: true, attempts: 1 }]);
    const sent = await mails();
    expect(sent.map((m) => [m.to_email, m.tag, m.idempotency_key])).toEqual([[sara.email, 'notice', `notice-${noticeId}`]]);
    for (const part of [sent[0].mail.subject, sent[0].mail.html, sent[0].mail.text]) {
      expect(part).not.toContain(SECRET_TITLE);
      expect(part).not.toContain(project.name);
    }
    expect(sent[0].mail.html).toContain('https://madar.test/notifications');
    const log = await office.sql<{ kind: string; user_id: string; ref: string; sent: boolean }>('select kind, user_id, ref, resend_id is not null as sent from mail_log');
    expect(log).toEqual([{ kind: 'notice', user_id: sara.id, ref: `notice-${noticeId}`, sent: true }]);
  });

  it('sends once when the effect runs twice: the claim, then the place in the quota and the idempotency key', async () => {
    const [sara] = members;
    await assign(sara.id, 'Second task');
    const [row] = await outboxOf(NOTICE_EFFECT);
    expect(row.done).toBe(true);
    // The row is done, so a second processOutbox claims nothing.
    expect(await processOutbox(deps, [row.id])).toEqual({ done: [], failed: [] });
    // A worker died after the send and before the done mark: the row opens again, and two workers run it at once.
    await office.sql('update outbox set done_at = null, claimed_until = null where id = $1', [row.id]);
    const [a, b] = await Promise.all([processOutbox(live(), [row.id]), processOutbox(live(), [row.id])]);
    expect([...a.done, ...b.done]).toEqual([row.id]);
    // The effect itself, run again by hand: the same key.
    await sendNoticeMail(row.payload, live());
    expect(await mails()).toHaveLength(1);
    expect(await office.sql("select count(*)::integer as n from mail_log where kind = 'notice'")).toEqual([{ n: 1 }]);
  });

  it('writes no mail row for a switch that is off, an in-app switch that is off, or a notice marked unread again', async () => {
    const [, omar, lina] = members;
    okOf(await call(omar.id, 'notifications.updateSettings', { channel: 'email', trigger: 'task_assigned', on: false }));
    okOf(await call(lina.id, 'notifications.updateSettings', { trigger: 'task_assigned', on: false }));
    const forOmar = await assign(omar.id, 'For Omar');
    const forLina = await assign(lina.id, 'For Lina');
    const omarNotice = await noticeOf(forOmar, omar.id);
    expect(omarNotice).toBeTruthy();
    // With in-app off there is no notice, so there is nothing to mail.
    expect(await noticeOf(forLina, lina.id)).toBeUndefined();
    okOf(await call(omar.id, 'notifications.markRead', { ids: [omarNotice] }));
    okOf(await call(omar.id, 'notifications.markUnread', { ids: [omarNotice] }));
    okOf(await call(omar.id, 'notifications.updateSettings', { channel: 'email', trigger: 'task_assigned', on: true }));
    okOf(await call(omar.id, 'notifications.markRead', { ids: [omarNotice] }));
    okOf(await call(omar.id, 'notifications.markUnread', { ids: [omarNotice] }));
    expect(await outboxOf(NOTICE_EFFECT)).toEqual([]);
    expect(await mails()).toEqual([]);
    // Lina's in-app switch goes back on for the next tests.
    okOf(await call(lina.id, 'notifications.updateSettings', { trigger: 'task_assigned', on: true }));
  });

  it('keeps notice 91 of the UTC day in the app and sends one warning to each Admin, once', async () => {
    const [sara, omar] = members;
    await office.sql("insert into mail_log (utc_day, kind, ref) select $1::date, 'notice', 'fill-' || i from generate_series(1, 90) as i", [NOW.toISOString().slice(0, 10)]);
    const first = await assign(sara.id, 'Over the limit');
    await assign(omar.id, 'Over the limit again');
    expect(await noticeOf(first, sara.id)).toBeTruthy();
    const admins = Object.values(office.seed.users).filter((u) => u.systemRole === 'admin' && u.active && u.kind === 'human').map((u) => u.id).sort();
    const warnings = await outboxOf(QUOTA_WARNING_EFFECT);
    expect(warnings.map((w) => w.payload.userId).sort()).toEqual(admins);
    expect(warnings.every((w) => w.done)).toBe(true);
    const sent = await mails();
    expect(sent.filter((m) => m.tag === 'notice')).toEqual([]);
    expect(sent.filter((m) => m.tag === 'quota-warning').map((m) => m.idempotency_key).sort()).toEqual(admins.map((id) => `quota-warning-${TODAY}-${id}`).sort());
    expect(await office.sql("select count(*)::integer as n from mail_log where kind = 'refused'")).toEqual([{ n: 1 }]);
    // Both notice rows are done: a refused mail stays in the app and is not tried again.
    expect((await outboxOf(NOTICE_EFFECT)).map((r) => r.done)).toEqual([true, true]);
  });

  it('counts the summary as the screens do, for every active person, and sends it once', async () => {
    const load = async () => ({
      tasks: (await office.sql<{ doc: Task }>('select doc from tasks')).map((r) => r.doc),
      projects: Object.fromEntries((await office.sql<{ doc: Project }>('select doc from projects')).map((r) => [r.doc.id, r.doc])),
      users: Object.fromEntries((await office.sql<{ doc: User }>('select doc from users')).map((r) => [r.doc.id, r.doc])),
    });
    // Pausing a project keeps its tasks in review, and the review list of the screens hides them: the summary must hide them too.
    const before = await load();
    const reviewed = before.tasks.find((t) => t.status === 'in_review' && before.projects[t.projectId]?.status === 'active'
      && reviewersOf({ projects: before.projects, users: before.users } as unknown as State, t.projectId).length > 0)!;
    const admin = Object.values(before.users).find((u) => u.active && u.kind === 'human' && u.systemRole === 'admin')!;
    okOf(await call(admin.id, 'projects.pause', { id: reviewed.projectId, reason: 'Wait for the client.' }));
    await office.sql('truncate mail_log, mail_outbox, outbox');
    const { tasks, projects, users } = await load();
    expect(projects[reviewed.projectId].status).toBe('on_hold');
    const state = { projects, users } as unknown as State;
    const people = Object.values(users).filter((u) => u.active && u.kind === 'human');
    let withSomething = 0;
    for (const person of people) {
      const dueToday = tasks.filter((t) => projects[t.projectId]?.status === 'active' && t.dueDate === TODAY
        && (t.status === 'todo' || t.status === 'in_progress') && peopleOfTask(t).includes(person.id)).length;
      const reviewsWaiting = tasks.filter((t) => projects[t.projectId]?.status === 'active' && t.status === 'in_review'
        && reviewersOf(state, t.projectId).includes(person.id)).length;
      // The review list that Work and Home show this person.
      expect({ id: person.id, reviews: okOf<unknown[]>(await call(person.id, 'tasks.list', { filter: 'review_for_me' })).length })
        .toEqual({ id: person.id, reviews: reviewsWaiting });
      const expected = dueToday + reviewsWaiting > 0 ? { dueToday, reviewsWaiting } : null;
      if (expected) withSomething += 1;
      expect({ id: person.id, summary: await deps.db.tx('read', (q) => buildSummary(q, person, TODAY)) }).toEqual({ id: person.id, summary: expected });
    }
    expect(withSomething).toBeGreaterThan(0);
    expect((await deps.db.tx('read', (q) => summaryPeople(q))).sort()).toEqual(
      Object.values(users).filter((u) => u.active && u.kind === 'human' && morningSummaryOn(u.preferences)).map((u) => u.id).sort(),
    );
    // One person with something to say: two runs of the job give one mail.
    const someone = people.find((p) => tasks.some((t) => t.dueDate === TODAY && peopleOfTask(t).includes(p.id) && projects[t.projectId]?.status === 'active' && (t.status === 'todo' || t.status === 'in_progress')))
      ?? people.find((p) => tasks.some((t) => t.status === 'in_review' && projects[t.projectId]?.status === 'active' && reviewersOf(state, t.projectId).includes(p.id)))!;
    expect(await sendSummary(live(), someone.id, TODAY)).toBe('sent');
    expect(await sendSummary(live(), someone.id, TODAY)).toBe('sent');
    expect((await mails()).map((m) => [m.to_email, m.tag, m.idempotency_key])).toEqual([[someone.email, 'summary', `summary-${TODAY}-${someone.id}`]]);
  });
});
