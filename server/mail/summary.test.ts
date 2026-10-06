import { describe, expect, it } from 'vitest';
import { defaultPreferences, type Preferences } from '../../src/api/contract/entities';
import { fakeDeps } from '../test/fakes/deps';
import { memoryMailDb } from './memoryMailDb';
import { ADMINS_SQL, USER_MAIL_SQL } from './notices';
import { SUMMARY_COUNTS_SQL, SUMMARY_PEOPLE_SQL, buildSummary, sendSummary, summaryPeople } from './summary';

/**
 * The morning summary (plan 5.4, 5.5; task N2.2): the count of tasks due today and of reviews that wait, and nothing when there is
 * nothing to say. The SQL runs on the local database in server/it/email.it.test.ts. Track N3 decides when the job sends it.
 */

const TODAY = '2026-10-04';

type Person = { kind: string; active: boolean; preferences: Preferences };

function setup(o: { counts?: { due_today: number; reviews_waiting: number }; person?: Partial<Person> } = {}) {
  const counts = o.counts ?? { due_today: 2, reviews_waiting: 1 };
  const who: Person = { kind: 'human', active: true, preferences: defaultPreferences(), ...o.person };
  const asked: unknown[][] = [];
  const mem = memoryMailDb((text, values) => {
    if (text === SUMMARY_COUNTS_SQL) {
      asked.push(values);
      return [counts];
    }
    if (text === USER_MAIL_SQL) return [{ user_id: values[0], email: 'sara@madar.test', gender: 'female', ...who }];
    if (text === ADMINS_SQL) return [];
    return undefined;
  });
  const deps = fakeDeps({ db: mem.db, config: { appUrl: 'https://madar.test' } });
  deps.clock.set(new Date(`${TODAY}T04:30:00Z`));
  return { mem, deps, asked };
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
  it('sends one counted summary in the person\'s language with the counts only', async () => {
    const { mem, deps } = setup({ person: { preferences: { ...defaultPreferences(), language: 'ar' } } });
    expect(await sendSummary(deps, 'usr_002', TODAY)).toBe('sent');
    const [mail] = deps.mail.sent;
    expect(mail).toMatchObject({ to: 'sara@madar.test', tag: 'summary', idempotencyKey: `summary-${TODAY}-usr_002` });
    expect(mail.html).toContain('dir="rtl"');
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
    expect(await sendSummary(setup({ counts: { due_today: 0, reviews_waiting: 0 } }).deps, 'usr_002', TODAY)).toBe('empty');
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
