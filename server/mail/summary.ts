import type { RoleSettings, Task, User } from '../../src/api/contract/entities';
import { morningSummaryOn, reviewersOfTask } from '../../src/api/notify';
import { canReview } from '../../src/api/permissions';
import { withOfficeRights } from '../../src/api/rights';
import type { State } from '../../src/api/store';
import type { Deps, Query } from '../core/ports';
import { jsonOf } from '../core/quiet';
import type { PersonLike, SettingsLike, WorkHours } from '../../src/lib/quietHours';
import { isLite } from '../data/dialect';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
import { USER_MAIL_SQL, appLink, litePerson, mailOf, mailable, sendWarned, type PersonRow } from './notices';
import { groupOpenTasks, weekEndOf, type OpenTask, type SummaryTasks } from './summaryTasks';
import { renderMail } from './templates';

/**
 * The morning summary (plan 5.4, 5.5; task N2.2; fbk_021). On a working day at 07:30 Riyadh, the 15-minute job (track N3) sends each
 * person in summaryPeople() one mail with sendSummary(): the open tasks of the person in three groups (past due, today, this week;
 * summaryTasks.ts), the count of the reviews that wait for them, and a link. Each task line has the title, the project key (or
 * Office) and the due day, and no other client data (owner, 2026-10-19; the plan 2, change 22 rule of no titles ends for the summary
 * only). The mail goes when something is past due or due today, or a review waits. A task due later this week alone makes no mail.
 * Nothing to say means no mail. The key summary-<day>-<person> keeps one place in the quota and one mail, also when the job runs
 * twice.
 *
 * The open tasks follow the screens: a task is open (to do or in progress), in an active project or an office task, and the person
 * leads it or helps with it (the rule of the due reminders, src/api/notify.ts). A review waits for the person when the task
 * is in review in an active project (the review list of tasks.list keeps only active projects) and the person reviews its project:
 * the active leader who holds the right to review (task.review.lead), or every active Admin when the project has no such leader (reviewersOf). An office task in review waits for its maker
 * (the person, or the person of the agent that made it), or for every active Admin when the maker left (reviewersOfTask; owner,
 * 2026-10-06).
 */

/**
 * $1 the person, $2 the day "YYYY-MM-DD", $3 the active people who hold the right to review the projects they lead (task.review.lead
 * or more, role rights version 2): a leader outside the list is no reviewer, so the Admins review that project, as for a project with
 * no leader (summaryReviewers).
 */
export const SUMMARY_COUNTS_SQL = `select
  (select count(*)::integer from tasks t left join projects p on p.id = t.project_id
    where (t.project_id is null or p.status = 'active') and t.due_date = $2 and t.status in ('todo', 'in_progress')
      and (t.owner_id = $1 or t.doc->'helperIds' ? $1)) as due_today,
  (select count(*)::integer from tasks t join projects p on p.id = t.project_id
    left join users l on l.id = p.leader_id and l.active and l.id = any($3::text[])
    where p.status = 'active' and t.status = 'in_review'
      and case when l.id is not null then l.id = $1
        else exists (select 1 from users a where a.id = $1 and a.active and a.doc->>'systemRole' = 'admin') end)
  + (select count(*)::integer from tasks t
    left join users c on c.id = t.doc->>'createdBy'
    left join users m on m.id = (case when c.kind = 'agent' and c.owner_id is not null then c.owner_id else t.doc->>'createdBy' end) and m.active
    where t.project_id is null and t.status = 'in_review'
      and case when m.id is not null then m.id = $1
        else exists (select 1 from users a where a.id = $1 and a.active and a.doc->>'systemRole' = 'admin') end) as reviews_waiting`;

/** The active humans with their role, and the roles of the office settings (the same value in each row): they give who may review as a leader. */
export const SUMMARY_REVIEWERS_SQL = `select u.id, u.doc->>'systemRole' as system_role, u.doc->>'roleId' as role_id,
  (select s.doc->'roles' from settings s where s.id = 'office') as roles
from users u where u.kind = 'human' and u.active`;

/**
 * The people who get the summary: active humans whose Morning summary is on or never set. Each row also holds the work hours the person
 * chose (null when none) and the office work hours (the same value in each row, null when none): the summary goes at the start of the
 * work hours of the person, on the work days of the person (quiet hours, owner 2026-10-22).
 */
export const SUMMARY_PEOPLE_SQL = `select id, doc->'preferences'->'workHours' as work_hours,
  (select s.doc->'workHours' from settings s where s.id = 'office') as office
from users
where kind = 'human' and active and coalesce((doc->'preferences'->>'morningSummary')::boolean, true)
order by ord`;

export type Summary = { dueToday: number; reviewsWaiting: number };

/**
 * The open tasks of one person that are due by the end of this week, with the code of their project. $1 the person, $2 the last
 * day of This week (weekEndOf). A task with no date is no row. summaryTasks.ts puts each row in its group.
 */
export const SUMMARY_TASKS_SQL = `select t.id, t.doc->>'title' as title, t.due_date, (t.doc->>'rank')::float8 as rank, p.code as project_code
from tasks t left join projects p on p.id = t.project_id
where (t.project_id is null or p.status = 'active') and t.status in ('todo', 'in_progress')
  and t.due_date <= $2 and (t.owner_id = $1 or t.doc->'helperIds' ? $1)`;

// SQLite forms (exit wave 3). The users and projects tables hold only id and doc: the people come from doc, and the counts are
// worked out in JavaScript on the office lists in memory with the rules of the screens (reviewersOfTask), as SUMMARY_COUNTS_SQL does.
export const SUMMARY_PEOPLE_LITE =
  "select rowid as ord, id, json_extract(doc, '$.preferences.workHours') as work_hours, "
  + "(select json_extract(s.doc, '$.workHours') from settings s where s.id = 'office') as office "
  + "from users where json_extract(doc, '$.kind') = 'human' and json_type(doc, '$.active') = 'true' "
  + "and coalesce(json_type(doc, '$.preferences.morningSummary'), 'null') in ('true', 'null')";
export const SUMMARY_DUE_LITE = "select doc, project_id from tasks where due_date = ?1 and status in ('todo', 'in_progress')";
export const SUMMARY_REVIEW_LITE = "select doc from tasks where status = 'in_review'";
export const SUMMARY_TASKS_LITE = "select doc, project_id from tasks where due_date <= ?1 and status in ('todo', 'in_progress')";

async function liteSummary(q: Query, userId: string, today: string): Promise<Summary> {
  const { lists } = await readLiteOffice(liteDbOf(q), q);
  const active = (projectId: string | null) => projectId === null || lists.projects[projectId]?.status === 'active';
  // reviewersOfTask reads only the users and projects of the State, and both are office lists.
  const state = lists as unknown as State;
  const due = await q<{ doc: Task; project_id: string | null }>(SUMMARY_DUE_LITE, [today]);
  const review = await q<{ doc: Task }>(SUMMARY_REVIEW_LITE);
  return {
    dueToday: due.filter((row) => active(row.project_id) && (row.doc.ownerId === userId || (row.doc.helperIds ?? []).includes(userId))).length,
    reviewsWaiting: review.filter((row) => active(row.doc.projectId) && reviewersOfTask(state, row.doc).includes(userId)).length,
  };
}

type ReviewerRow = { id: string; system_role: string | null; role_id: string | null; roles: RoleSettings | null };

/** The ids of the active people who hold the right to review the projects they lead (canReview as a leader). */
export async function summaryReviewers(q: Query): Promise<string[]> {
  const rows = await q<ReviewerRow>(SUMMARY_REVIEWERS_SQL);
  return rows
    .filter((row) => canReview(withOfficeRights({ id: row.id, systemRole: row.system_role ?? 'member', roleId: row.role_id ?? undefined, active: true } as User, row.roles ?? undefined), 'leader'))
    .map((row) => row.id);
}

/** The counts of one person and one day, or null when both are 0. */
export async function buildSummary(q: Query, user: { id: string }, today: string): Promise<Summary | null> {
  if (isLite(q)) {
    const summary = await liteSummary(q, user.id, today);
    return summary.dueToday > 0 || summary.reviewsWaiting > 0 ? summary : null;
  }
  const [row] = await q<{ due_today: number; reviews_waiting: number }>(SUMMARY_COUNTS_SQL, [user.id, today, await summaryReviewers(q)]);
  const summary = { dueToday: Number(row?.due_today ?? 0), reviewsWaiting: Number(row?.reviews_waiting ?? 0) };
  return summary.dueToday > 0 || summary.reviewsWaiting > 0 ? summary : null;
}

async function liteOpenTasks(q: Query, userId: string, lastDay: string): Promise<OpenTask[]> {
  const { lists } = await readLiteOffice(liteDbOf(q), q);
  const rows = await q<{ doc: Task; project_id: string | null }>(SUMMARY_TASKS_LITE, [lastDay]);
  return rows
    .filter((row) => (row.project_id === null || lists.projects[row.project_id]?.status === 'active') && (row.doc.ownerId === userId || (row.doc.helperIds ?? []).includes(userId)))
    .map((row) => ({
      id: row.doc.id, title: row.doc.title, dueDate: row.doc.dueDate as string, rank: row.doc.rank ?? null,
      projectCode: row.project_id === null ? null : lists.projects[row.project_id].code,
    }));
}

async function openTasks(q: Query, userId: string, lastDay: string): Promise<OpenTask[]> {
  if (isLite(q)) return liteOpenTasks(q, userId, lastDay);
  const rows = await q<{ id: string; title: string; due_date: string; rank: number | null; project_code: string | null }>(SUMMARY_TASKS_SQL, [userId, lastDay]);
  return rows.map((row) => ({ id: row.id, title: row.title, dueDate: row.due_date, rank: row.rank === null ? null : Number(row.rank), projectCode: row.project_code }));
}

/** What one morning mail says: the open tasks in their groups, and the count of the reviews that wait. */
export type Morning = { tasks: SummaryTasks; reviewsWaiting: number };

/** The morning mail of one person and one day, or null when nothing is past due or due today and no review waits. */
export async function buildMorning(q: Query, user: { id: string }, today: string): Promise<Morning | null> {
  const counts = await buildSummary(q, user, today);
  const tasks = groupOpenTasks(await openTasks(q, user.id, weekEndOf(today)), today);
  const reviewsWaiting = counts?.reviewsWaiting ?? 0;
  return tasks.pastDue.length > 0 || tasks.today.length > 0 || reviewsWaiting > 0 ? { tasks, reviewsWaiting } : null;
}

/** One person of the summary list, with the parts that quiet hours read (src/lib/quietHours.ts). */
export type SummaryPerson = { id: string; person: PersonLike; settings: SettingsLike };

type PeopleRow = { ord?: number; id: string; work_hours?: unknown; office?: unknown };

/** The people who get the summary, in order, with their work hours. */
export async function summaryRoster(q: Query): Promise<SummaryPerson[]> {
  const rows = isLite(q) ? (await q<PeopleRow>(SUMMARY_PEOPLE_LITE)).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0)) : await q<PeopleRow>(SUMMARY_PEOPLE_SQL);
  return rows.map((row) => {
    const workHours = jsonOf<WorkHours>(row.work_hours);
    const office = jsonOf<NonNullable<NonNullable<SettingsLike>['workHours']>>(row.office);
    return { id: row.id, person: workHours ? { workHours } : undefined, settings: office ? { workHours: office } : undefined };
  });
}

export async function summaryPeople(q: Query): Promise<string[]> {
  return (await summaryRoster(q)).map((row) => row.id);
}

/** skipped: not an active human, or the summary is off. empty: nothing to say. over: the notice limit of the day stopped it. */
export type SummaryOutcome = 'sent' | 'over' | 'empty' | 'skipped';

/** One summary mail. It throws when the send fails; the job tries again on its next run with the same key. */
export async function sendSummary(deps: Deps, userId: string, today: string): Promise<SummaryOutcome> {
  const [person] = isLite(deps.db) ? await litePerson(deps.db, userId) : await deps.db.statement<PersonRow>('read', USER_MAIL_SQL, [userId]);
  if (!person || !mailable(person) || !morningSummaryOn(person.preferences)) return 'skipped';
  const morning = await deps.db.tx('read', (q) => buildMorning(q, { id: userId }, today));
  if (!morning) return 'empty';
  const rendered = renderMail(
    'summary', person.preferences.language,
    { ...morning.tasks, reviewsWaiting: morning.reviewsWaiting, link: appLink(deps.config.appUrl, '/work') },
    { reader: person.gender ?? undefined }, { appUrl: deps.config.appUrl },
  );
  const result = await sendWarned(deps, 'summary', mailOf(person.email, rendered, 'summary', `summary-${today}-${userId}`), userId);
  return result.status;
}
