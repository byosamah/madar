import { describe, expect, it } from 'vitest';
import { defaultPreferences, type Task } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { makeTask, makeUser } from '../../src/test/factories';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { fakeDeps } from '../test/fakes/deps';
import { outboxMailPort } from './outboxDriver';
import { sendSummary } from './summary';

/**
 * The morning email with the open tasks (fbk_021, owner 2026-10-19), end to end on the SQLite office and the outbox driver
 * (MAIL_DRIVER=outbox): sendSummary reads the tasks of the person, renders the mail, and the driver writes it to mail_outbox, so no
 * mail leaves the Mac. A person with many tasks, a person with none, and a person who reads Arabic.
 */

const DAY = '2026-10-04'; // Sunday. This week ends on Saturday 2026-10-10.
const AT = new Date('2026-10-04T04:30:00Z');

let n = 0;
const task = (ownerId: string, title: string, dueDate: string | null, more: Partial<Task> = {}): Task =>
  makeTask({ id: `tsk_9${String((n += 1)).padStart(2, '0')}`, ownerId, title, dueDate, projectId: 'prj_001', status: 'todo', createdBy: 'usr_001', ...more });

async function office() {
  const lite = await freshLite();
  const seed: State = await buildSeed(DAY, async () => undefined);
  seed.tasks = {};
  seed.projects.prj_001 = { ...seed.projects.prj_001, code: '260902AZT-RES-Villa', name: 'The Rashid villa', status: 'active' };
  seed.projects.prj_002 = { ...seed.projects.prj_002, code: '260903BNH-COM-Tower', name: 'Bunah tower', leaderId: 'usr_902', status: 'active' };
  seed.projects.prj_003 = { ...seed.projects.prj_003, status: 'on_hold' };
  const people = {
    usr_901: makeUser('usr_901', { name: 'Faisal Many', email: 'many@madar.test' }),
    usr_902: makeUser('usr_902', { name: 'Reem Arabic', email: 'arabic@madar.test', gender: 'female', preferences: { ...defaultPreferences(), language: 'ar' } }),
    usr_903: makeUser('usr_903', { name: 'Omar None', email: 'none@madar.test' }),
    usr_904: makeUser('usr_904', { name: 'Sara Later', email: 'later@madar.test' }),
  };
  Object.assign(seed.users, people);
  const tasks: Task[] = [
    // usr_901, many tasks: 3 past due, 2 due today (one is an office task), 6 this week, and 2 later. Titles cut by the rules below.
    task('usr_901', 'Update the setback drawings', '2026-10-01'),
    task('usr_901', 'Send the survey to the client', '2026-10-02'),
    task('usr_901', 'Check the stair section', '2026-10-03'),
    task('usr_901', 'Review the facade options', DAY),
    task('usr_901', 'Renew the trade licence', DAY, { projectId: null, stageId: null }),
    ...['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-08'].map((d, i) => task('usr_901', `Prepare the site visit ${i + 1}`, d)),
    task('usr_901', 'Plan the tender package', '2026-10-20'),
    task('usr_901', 'Close the year file', '2026-11-01'),
    // Not in the mail: done, in review, no date, a paused project, and the task of another person.
    task('usr_901', 'A finished drawing', '2026-09-20', { status: 'done' }),
    task('usr_901', 'A drawing in review', '2026-09-21', { status: 'in_review' }),
    task('usr_901', 'A task with no date', null),
    task('usr_901', 'A task of a paused project', '2026-09-22', { projectId: 'prj_003', stageId: null }),
    task('usr_003', 'A task of another person', '2026-09-22'),
    // usr_902 reads Arabic: one past due, one due today, two this week, and the review of a task in the project she leads.
    task('usr_902', 'Check the setback of the villa', '2026-10-02'),
    task('usr_902', 'مراجعة مخططات الواجهة', DAY, { projectId: 'prj_002' }),
    task('usr_902', 'Send the drawings to Balady', '2026-10-06', { projectId: 'prj_002' }),
    task('usr_902', 'Update the door schedule', '2026-10-07'),
    task('usr_903', 'A task far away', '2026-12-01'),
    // usr_904 has one task later this week and nothing else: no mail.
    task('usr_904', 'Plan the site visit', '2026-10-08'),
  ];
  // usr_902 leads prj_002, so a task of another person in review waits for her.
  tasks.push(task('usr_003', 'A drawing for review', '2026-10-01', { projectId: 'prj_002', status: 'in_review' }));
  for (const t of tasks) seed.tasks[t.id] = t;
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db, config: { appUrl: 'https://madar.test' } });
  deps.clock.set(AT);
  // The outbox driver of the test deployment: the mail goes to mail_outbox, not to Resend.
  const withOutbox = Object.assign(deps, { mail: outboxMailPort(lite.db) as unknown as typeof deps.mail });
  const mails = () => lite.db.statement<{ to_email: string; tag: string; idempotency_key: string; mail: string | { subject: string; html: string; text: string } }>('read', 'select to_email, tag, idempotency_key, mail from mail_outbox order by id')
    .then((rows) => rows.map((row) => ({ ...row, mail: (typeof row.mail === 'string' ? JSON.parse(row.mail) : row.mail) as { subject: string; html: string; text: string } })));
  return { deps: withOutbox, mails };
}

describe('the morning email with the open tasks, through the outbox driver', () => {
  it('lists a person with many tasks in three groups: eight lines, past due first, then "and 3 more tasks"', async () => {
    const { deps, mails } = await office();
    expect(await sendSummary(deps, 'usr_901', DAY)).toBe('sent');
    const [row] = await mails();
    expect(row).toMatchObject({ to_email: 'many@madar.test', tag: 'summary', idempotency_key: `summary-${DAY}-usr_901` });
    const { subject, html, text } = row.mail;
    expect(subject).toBe('Your morning summary from Madar');
    // Eight lines in all, in the order of the groups.
    expect(text.match(/^- /gm)).toHaveLength(8);
    const lines = [...text.matchAll(/^- (.+)\n  (.+)$/gm)].map((m) => [m[1], m[2]]);
    expect(lines).toEqual([
      ['Update the setback drawings', '260902AZT · Thu 1 Oct'],
      ['Send the survey to the client', '260902AZT · Fri 2 Oct'],
      ['Check the stair section', '260902AZT · Sat 3 Oct'],
      ['Renew the trade licence', 'Office · Sun 4 Oct'],
      ['Review the facade options', '260902AZT · Sun 4 Oct'],
      ['Prepare the site visit 1', '260902AZT · Mon 5 Oct'],
      ['Prepare the site visit 2', '260902AZT · Mon 5 Oct'],
      ['Prepare the site visit 3', '260902AZT · Tue 6 Oct'],
    ]);
    expect(text.indexOf('\nPast due\n')).toBeLessThan(text.indexOf('\nToday\n'));
    expect(text.indexOf('\nToday\n')).toBeLessThan(text.indexOf('\nThis week\n'));
    expect(text).toContain('and 3 more tasks.');
    expect(text).not.toMatch(/reviews? waits? for you/);
    // Left out: done, in review, no date, a paused project, another person's task, and the tasks due after this week.
    for (const left of ['A finished drawing', 'A drawing in review', 'A task with no date', 'A task of a paused project', 'A task of another person', 'Plan the tender package', 'Close the year file']) {
      expect(text, left).not.toContain(left);
      expect(html, left).not.toContain(left);
    }
    // No project name and no client name, only the key.
    expect(text + html).not.toContain('The Rashid villa');
    expect(text).toContain('Open Madar: https://madar.test/work');
    expect(html.match(/>Open Madar<\/a>/g)).toHaveLength(1);
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html.match(/<bdi dir="auto">/g)).toHaveLength(8);
  });

  it('sends nothing to a person with no open task, and nothing for one task due later this week', async () => {
    const { deps, mails } = await office();
    expect(await sendSummary(deps, 'usr_903', DAY)).toBe('empty');
    expect(await sendSummary(deps, 'usr_904', DAY)).toBe('empty');
    expect(await mails()).toEqual([]);
  });

  it('writes the mail in Arabic, right to left, for a person who reads Arabic, with the review that waits for her', async () => {
    const { deps, mails } = await office();
    expect(await sendSummary(deps, 'usr_902', DAY)).toBe('sent');
    const [row] = await mails();
    const { subject, html, text } = row.mail;
    expect(subject).toBe('ملخص الصباح من مدار');
    expect(html).toMatch(/<html lang="ar" dir="rtl">/);
    expect(text).toContain('\nتجاوزت موعدها\n- Check the setback of the villa\n  260902AZT · الجمعة، 2 أكتوبر\n');
    expect(text).toContain('\nاليوم\n- مراجعة مخططات الواجهة\n  260903BNH · الأحد، 4 أكتوبر\n');
    expect(text).toContain('\nهذا الأسبوع\n');
    expect(text).toContain('- Update the door schedule\n  260902AZT \u00b7 الأربعاء، 7 أكتوبر');
    expect(text).toContain('مراجعة واحدة بانتظارك.');
    expect(text).not.toContain('more');
    expect(text).toContain('فتح مدار: https://madar.test/work');
  });

  it('sends one mail for one person and one day when the job runs twice', async () => {
    const { deps, mails } = await office();
    expect(await sendSummary(deps, 'usr_901', DAY)).toBe('sent');
    expect(await sendSummary(deps, 'usr_901', DAY)).toBe('sent');
    expect(await mails()).toHaveLength(1);
  });
});
