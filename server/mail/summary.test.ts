import { describe, expect, it } from 'vitest';
import { defaultPreferences, type Preferences } from '../../src/api/contract/entities';
import { fakeDeps } from '../test/fakes/deps';
import { memoryMailDb } from './memoryMailDb';
import { ADMINS_SQL, USER_MAIL_SQL } from './notices';
import { SUMMARY_COUNTS_SQL, SUMMARY_PEOPLE_SQL, SUMMARY_TASKS_SQL, buildMorning, buildSummary, sendSummary, summaryPeople } from './summary';

/**
 * The morning summary (plan 5.4, 5.5; task N2.2; fbk_021, owner 2026-10-19): the open tasks of the person in three groups (past due,
 * today, this week) and the count of reviews that wait, and nothing when there is nothing to say. The SQL runs on the local
 * database in server/it/email.it.test.ts. Track N3 decides when the job sends it.
 */

const TODAY = '2026-10-04';

type Person = { kind: string; active: boolean; preferences: Preferences };
/** A row of SUMMARY_TASKS_SQL. */
type TaskRowOf = { id: string; title: string; due_date: string; rank: number | null; project_code: string | null };
const row = (id: string, title: string, due_date: string, more: Partial<TaskRowOf> = {}): TaskRowOf => ({ id, title, due_date, rank: null, project_code: '260902AZT-RES-Villa', ...more });
const TWO_TASKS = [row('tsk_001', 'Check the setback', TODAY), row('tsk_002', 'Send the survey', '2026-10-01')];

function setup(o: { counts?: { due_today: number; reviews_waiting: number }; person?: Partial<Person>; tasks?: TaskRowOf[] } = {}) {
  const counts = o.counts ?? { due_today: 2, reviews_waiting: 1 };
  const tasks = o.tasks ?? TWO_TASKS;
  const askedTasks: unknown[][] = [];
  const who: Person = { kind: 'human', active: true, preferences: defaultPreferences(), ...o.person };
  const asked: unknown[][] = [];
  const mem = memoryMailDb((text, values) => {
    if (text === SUMMARY_COUNTS_SQL) {
      asked.push(values);
      return [counts];
    }
    if (text === SUMMARY_TASKS_SQL) {
      askedTasks.push(values);
      return tasks;
    }
    if (text === USER_MAIL_SQL) return [{ user_id: values[0], email: 'sara@madar.test', gender: 'female', ...who }];
    if (text === ADMINS_SQL) return [];
    return undefined;
  });
  const deps = fakeDeps({ db: mem.db, config: { appUrl: 'https://madar.test' } });
  deps.clock.set(new Date(`${TODAY}T04:30:00Z`));
  return { mem, deps, asked, askedTasks };
}

describe('buildSummary', () => {
  it('counts the tasks due today and the reviews that wait, for one person and one day', async () => {
    const { mem, asked } = setup({ counts: { due_today: 3, reviews_waiting: 0 } });
    expect(await buildSummary(mem.q, { id: 'usr_002' }, TODAY)).toEqual({ dueToday: 3, reviewsWaiting: 0 });
    expect(asked).toEqual([['usr_002', TODAY]]);
  });

  it('gives null when there is nothing to say', async () => {
    const { mem } = setup({ counts: { due_today: 0, reviews_waiting: 0 } });
    expect(await buildSummary(mem.q, { id: 'usr_002' }, TODAY)).toBeNull();
  });

  it('counts only open tasks of active projects that the person leads or helps with, and the reviews of the reviewer', () => {
    expect(SUMMARY_COUNTS_SQL).toMatch(/status in \('todo', 'in_progress'\)/);
    expect(SUMMARY_COUNTS_SQL).toMatch(/p\.status = 'active'/);
    expect(SUMMARY_COUNTS_SQL).toContain("doc->'helperIds' ? $1");
    expect(SUMMARY_COUNTS_SQL).toMatch(/'in_review'/);
  });

  it('counts the office tasks of the person, and the reviews of the office tasks that the person made (owner, 2026-10-06)', () => {
    const [due, reviews] = SUMMARY_COUNTS_SQL.split('as due_today');
    expect(due).toMatch(/t\.project_id is null or p\.status = 'active'/);
    expect(reviews).toMatch(/t\.project_id is null and t\.status = 'in_review'/);
    expect(reviews).toContain("t.doc->>'createdBy'");
  });

  it('counts a review only in an active project, as the review list of Work and Home does', () => {
    const reviews = SUMMARY_COUNTS_SQL.split('as due_today')[1];
    expect(reviews).toMatch(/'in_review'/);
    expect(reviews).toMatch(/p\.status = 'active'/);
  });
});

describe('buildMorning', () => {
  it('groups the open tasks of the person and counts the reviews, for one person and one day', async () => {
    const { mem, asked, askedTasks } = setup({ counts: { due_today: 1, reviews_waiting: 2 } });
    const morning = await buildMorning(mem.q, { id: 'usr_002' }, TODAY);
    expect(morning).toEqual({
      tasks: {
        pastDue: [{ title: 'Send the survey', where: '260902AZT', due: '2026-10-01' }],
        today: [{ title: 'Check the setback', where: '260902AZT', due: TODAY }],
        week: [],
        more: 0,
      },
      reviewsWaiting: 2,
    });
    expect(asked).toEqual([['usr_002', TODAY]]);
    // The statement takes the person and the last day of This week (the Saturday after Sunday 4 October).
    expect(askedTasks).toEqual([['usr_002', '2026-10-10']]);
  });

  it('has something to say for a past due task alone, a task due today alone, or a review alone', async () => {
    const pastOnly = setup({ counts: { due_today: 0, reviews_waiting: 0 }, tasks: [row('tsk_002', 'Send the survey', '2026-10-01')] });
    expect(await buildMorning(pastOnly.mem.q, { id: 'usr_002' }, TODAY)).toMatchObject({ reviewsWaiting: 0, tasks: { pastDue: [{ title: 'Send the survey' }] } });
    const todayOnly = setup({ counts: { due_today: 1, reviews_waiting: 0 }, tasks: [row('tsk_001', 'Check the setback', TODAY)] });
    expect(await buildMorning(todayOnly.mem.q, { id: 'usr_002' }, TODAY)).toMatchObject({ tasks: { today: [{ title: 'Check the setback' }] } });
    const reviewOnly = setup({ counts: { due_today: 0, reviews_waiting: 1 }, tasks: [] });
    expect(await buildMorning(reviewOnly.mem.q, { id: 'usr_002' }, TODAY)).toMatchObject({ reviewsWaiting: 1, tasks: { pastDue: [], today: [], week: [], more: 0 } });
  });

  it('gives null when nothing is past due or due today and no review waits, also when a task is due later this week', async () => {
    const nothing = setup({ counts: { due_today: 0, reviews_waiting: 0 }, tasks: [] });
    expect(await buildMorning(nothing.mem.q, { id: 'usr_002' }, TODAY)).toBeNull();
    const later = setup({ counts: { due_today: 0, reviews_waiting: 0 }, tasks: [row('tsk_003', 'Plan the site visit', '2026-10-07')] });
    expect(await buildMorning(later.mem.q, { id: 'usr_002' }, TODAY)).toBeNull();
  });

  it('lists the open tasks of this week when something else makes the mail, and an office task has no key', async () => {
    const { mem } = setup({ counts: { due_today: 1, reviews_waiting: 0 }, tasks: [row('tsk_001', 'Check the setback', TODAY), row('tsk_003', 'Renew the licence', '2026-10-07', { project_code: null })] });
    expect(await buildMorning(mem.q, { id: 'usr_002' }, TODAY)).toMatchObject({ tasks: { week: [{ title: 'Renew the licence', where: null, due: '2026-10-07' }] } });
  });

  it('reads the open tasks that the person leads or helps with, in an active project or with no project, up to the end of the week', () => {
    expect(SUMMARY_TASKS_SQL).toMatch(/status in \('todo', 'in_progress'\)/);
    expect(SUMMARY_TASKS_SQL).toMatch(/t\.project_id is null or p\.status = 'active'/);
    expect(SUMMARY_TASKS_SQL).toContain("doc->'helperIds' ? $1");
    expect(SUMMARY_TASKS_SQL).toContain('t.owner_id = $1');
    expect(SUMMARY_TASKS_SQL).toMatch(/t\.due_date <= \$2/);
    expect(SUMMARY_TASKS_SQL).toContain('p.code');
  });
});

describe('summaryPeople', () => {
  it('lists the ids that the statement gives', async () => {
    const q = (async (text: string) => {
      expect(text).toBe(SUMMARY_PEOPLE_SQL);
      return [{ id: 'usr_001' }, { id: 'usr_002' }];
    }) as never;
    expect(await summaryPeople(q)).toEqual(['usr_001', 'usr_002']);
  });

  it('takes active people, no agents, with the summary on or never set', () => {
    expect(SUMMARY_PEOPLE_SQL).toMatch(/kind = 'human'/);
    expect(SUMMARY_PEOPLE_SQL).toMatch(/active/);
    expect(SUMMARY_PEOPLE_SQL).toMatch(/morningSummary/);
  });
});

describe('sendSummary', () => {
  it('sends one summary in the person\'s language with the open tasks: the title, the project key and the day of each', async () => {
    const { mem, deps } = setup({ person: { preferences: { ...defaultPreferences(), language: 'ar' } } });
    expect(await sendSummary(deps, 'usr_002', TODAY)).toBe('sent');
    const [mail] = deps.mail.sent;
    expect(mail).toMatchObject({ to: 'sara@madar.test', tag: 'summary', idempotencyKey: `summary-${TODAY}-usr_002` });
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.text).toContain('- Check the setback\n  260902AZT \u00b7 الأحد، 4 أكتوبر');
    expect(mail.text).toContain('- Send the survey\n  260902AZT \u00b7 الخميس، 1 أكتوبر');
    expect(mail.text).toContain('مراجعة واحدة بانتظارك.');
    // The project key only: no project name and no client name.
    expect(mail.text).not.toContain('Villa');
    expect(mail.html).toContain('https://madar.test/work');
    // The Madar mark at the app address of the server config (TASKS.md, Logo, point 4).
    expect(mail.html).toContain('<img src="https://madar.test/icons/madar-192.png"');
    expect(mem.log.map((r) => [r.kind, r.ref])).toEqual([['summary', `summary-${TODAY}-usr_002`]]);
  });

  it('sends once when the job runs twice on the same day', async () => {
    const { mem, deps } = setup();
    await sendSummary(deps, 'usr_002', TODAY);
    await sendSummary(deps, 'usr_002', TODAY);
    expect(mem.log).toHaveLength(1);
    expect(new Set(deps.mail.sent.map((m) => m.idempotencyKey)).size).toBe(1);
  });

  it('sends nothing when there is nothing to say, when the summary is off, or to a person who left', async () => {
    expect(await sendSummary(setup({ counts: { due_today: 0, reviews_waiting: 0 }, tasks: [] }).deps, 'usr_002', TODAY)).toBe('empty');
    // A task due later this week alone does not make a mail.
    expect(await sendSummary(setup({ counts: { due_today: 0, reviews_waiting: 0 }, tasks: [row('tsk_003', 'Plan the site visit', '2026-10-07')] }).deps, 'usr_002', TODAY)).toBe('empty');
    const off = setup({ person: { preferences: { ...defaultPreferences(), morningSummary: false } } });
    expect(await sendSummary(off.deps, 'usr_002', TODAY)).toBe('skipped');
    expect(off.asked).toEqual([]);
    expect(await sendSummary(setup({ person: { active: false } }).deps, 'usr_002', TODAY)).toBe('skipped');
    expect(await sendSummary(setup({ person: { kind: 'agent' } }).deps, 'usr_002', TODAY)).toBe('skipped');
  });

  it('stops at the notice limit of the day and leaves the first-refusal mark', async () => {
    const { mem, deps } = setup();
    mem.fill('notice', 90, TODAY);
    expect(await sendSummary(deps, 'usr_002', TODAY)).toBe('over');
    expect(deps.mail.sent).toEqual([]);
    expect(mem.log.filter((r) => r.kind === 'refused')).toHaveLength(1);
  });
});
