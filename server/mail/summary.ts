import type { Task } from '../../src/api/contract/entities';
import { morningSummaryOn, reviewersOfTask } from '../../src/api/notify';
import type { State } from '../../src/api/store';
import type { Deps, Query } from '../core/ports';
import { isLite } from '../data/dialect';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
import { USER_MAIL_SQL, appLink, litePerson, mailOf, mailable, sendWarned, type PersonRow } from './notices';
import { renderMail } from './templates';

/**
 * The morning summary (plan 5.4, 5.5; task N2.2). On a working day at 07:30 Riyadh, the 15-minute job (track N3) sends each
 * person in summaryPeople() one mail with sendSummary(): the count of their tasks due today and of the reviews that wait for
 * them, and a link. No titles and no project names (plan 2, change 22). Nothing to say means no mail. The key
 * summary-<day>-<person> keeps one place in the quota and one mail, also when the job runs twice.
 *
 * The counts follow the screens: a task due today is open (to do or in progress), in an active project or an office task, and the
 * person leads it or helps with it (the rule of the due reminders, src/api/notify.ts). A review waits for the person when the task
 * is in review in an active project (the review list of tasks.list keeps only active projects) and the person reviews its project:
 * the active leader, or every active Admin when the project has none (reviewersOf). An office task in review waits for its maker
 * (the person, or the person of the agent that made it), or for every active Admin when the maker left (reviewersOfTask; owner,
 * 2026-10-06).
 */

/** $1 the person, $2 the day "YYYY-MM-DD". */
export const SUMMARY_COUNTS_SQL = `select
  (select count(*)::integer from tasks t left join projects p on p.id = t.project_id
    where (t.project_id is null or p.status = 'active') and t.due_date = $2 and t.status in ('todo', 'in_progress')
      and (t.owner_id = $1 or t.doc->'helperIds' ? $1)) as due_today,
  (select count(*)::integer from tasks t join projects p on p.id = t.project_id
    left join users l on l.id = p.leader_id and l.active
    where p.status = 'active' and t.status = 'in_review'
      and case when l.id is not null then l.id = $1
        else exists (select 1 from users a where a.id = $1 and a.active and a.doc->>'systemRole' = 'admin') end)
  + (select count(*)::integer from tasks t
    left join users c on c.id = t.doc->>'createdBy'
    left join users m on m.id = (case when c.kind = 'agent' and c.owner_id is not null then c.owner_id else t.doc->>'createdBy' end) and m.active
    where t.project_id is null and t.status = 'in_review'
      and case when m.id is not null then m.id = $1
        else exists (select 1 from users a where a.id = $1 and a.active and a.doc->>'systemRole' = 'admin') end) as reviews_waiting`;

/** The people who get the summary: active humans whose Morning summary is on or never set. */
export const SUMMARY_PEOPLE_SQL = `select id from users
where kind = 'human' and active and coalesce((doc->'preferences'->>'morningSummary')::boolean, true)
order by ord`;

export type Summary = { dueToday: number; reviewsWaiting: number };

// SQLite forms (exit wave 3). The users and projects tables hold only id and doc: the people come from doc, and the counts are
// worked out in JavaScript on the office lists in memory with the rules of the screens (reviewersOfTask), as SUMMARY_COUNTS_SQL does.
export const SUMMARY_PEOPLE_LITE =
  "select rowid as ord, id from users where json_extract(doc, '$.kind') = 'human' and json_type(doc, '$.active') = 'true' "
  + "and coalesce(json_type(doc, '$.preferences.morningSummary'), 'null') in ('true', 'null')";
export const SUMMARY_DUE_LITE = "select doc, project_id from tasks where due_date = ?1 and status in ('todo', 'in_progress')";
export const SUMMARY_REVIEW_LITE = "select doc from tasks where status = 'in_review'";

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

/** The counts of one person and one day, or null when both are 0. */
export async function buildSummary(q: Query, user: { id: string }, today: string): Promise<Summary | null> {
  if (isLite(q)) {
    const summary = await liteSummary(q, user.id, today);
    return summary.dueToday > 0 || summary.reviewsWaiting > 0 ? summary : null;
  }
  const [row] = await q<{ due_today: number; reviews_waiting: number }>(SUMMARY_COUNTS_SQL, [user.id, today]);
  const summary = { dueToday: Number(row?.due_today ?? 0), reviewsWaiting: Number(row?.reviews_waiting ?? 0) };
  return summary.dueToday > 0 || summary.reviewsWaiting > 0 ? summary : null;
}

export async function summaryPeople(q: Query): Promise<string[]> {
  if (isLite(q)) return (await q<{ ord: number; id: string }>(SUMMARY_PEOPLE_LITE)).sort((a, b) => a.ord - b.ord).map((row) => row.id);
  return (await q<{ id: string }>(SUMMARY_PEOPLE_SQL)).map((row) => row.id);
}

/** skipped: not an active human, or the summary is off. empty: nothing to say. over: the notice limit of the day stopped it. */
export type SummaryOutcome = 'sent' | 'over' | 'empty' | 'skipped';

/** One summary mail. It throws when the send fails; the job tries again on its next run with the same key. */
export async function sendSummary(deps: Deps, userId: string, today: string): Promise<SummaryOutcome> {
  const [person] = isLite(deps.db) ? await litePerson(deps.db, userId) : await deps.db.statement<PersonRow>('read', USER_MAIL_SQL, [userId]);
  if (!person || !mailable(person) || !morningSummaryOn(person.preferences)) return 'skipped';
  const summary = await deps.db.tx('read', (q) => buildSummary(q, { id: userId }, today));
  if (!summary) return 'empty';
  const rendered = renderMail('summary', person.preferences.language, { ...summary, link: appLink(deps.config.appUrl, '/work') }, { reader: person.gender ?? undefined }, { appUrl: deps.config.appUrl });
  const result = await sendWarned(deps, 'summary', mailOf(person.email, rendered, 'summary', `summary-${today}-${userId}`), userId);
  return result.status;
}
