import { morningSummaryOn } from '../../src/api/notify';
import type { Deps, Query } from '../core/ports';
import { USER_MAIL_SQL, appLink, mailOf, mailable, sendWarned, type PersonRow } from './notices';
import { renderMail } from './templates';

/**
 * The morning summary (plan 5.4, 5.5; task N2.2). On a working day at 07:30 Riyadh, the 15-minute job (track N3) sends each
 * person in summaryPeople() one mail with sendSummary(): the count of their tasks due today and of the reviews that wait for
 * them, and a link. No titles and no project names (plan 2, change 22). Nothing to say means no mail. The key
 * summary-<day>-<person> keeps one place in the quota and one mail, also when the job runs twice.
 *
 * The counts follow the screens: a task due today is open (to do or in progress), in an active project, and the person leads it
 * or helps with it (the rule of the due reminders, src/api/notify.ts). A review waits for the person when the task is in review
 * and the person reviews its project: the active leader, or every active Admin when the project has none (reviewersOf).
 */

/** $1 the person, $2 the day "YYYY-MM-DD". */
export const SUMMARY_COUNTS_SQL = `select
  (select count(*)::integer from tasks t join projects p on p.id = t.project_id
    where p.status = 'active' and t.due_date = $2 and t.status in ('todo', 'in_progress')
      and (t.owner_id = $1 or t.doc->'helperIds' ? $1)) as due_today,
  (select count(*)::integer from tasks t join projects p on p.id = t.project_id
    left join users l on l.id = p.leader_id and l.active
    where t.status = 'in_review'
      and case when l.id is not null then l.id = $1
        else exists (select 1 from users a where a.id = $1 and a.active and a.doc->>'systemRole' = 'admin') end) as reviews_waiting`;

/** The people who get the summary: active humans whose Morning summary is on or never set. */
export const SUMMARY_PEOPLE_SQL = `select id from users
where kind = 'human' and active and coalesce((doc->'preferences'->>'morningSummary')::boolean, true)
order by ord`;

export type Summary = { dueToday: number; reviewsWaiting: number };

/** The counts of one person and one day, or null when both are 0. */
export async function buildSummary(q: Query, user: { id: string }, today: string): Promise<Summary | null> {
  const [row] = await q<{ due_today: number; reviews_waiting: number }>(SUMMARY_COUNTS_SQL, [user.id, today]);
  const summary = { dueToday: Number(row?.due_today ?? 0), reviewsWaiting: Number(row?.reviews_waiting ?? 0) };
  return summary.dueToday > 0 || summary.reviewsWaiting > 0 ? summary : null;
}

export async function summaryPeople(q: Query): Promise<string[]> {
  return (await q<{ id: string }>(SUMMARY_PEOPLE_SQL)).map((row) => row.id);
}

/** skipped: not an active human, or the summary is off. empty: nothing to say. over: the notice limit of the day stopped it. */
export type SummaryOutcome = 'sent' | 'over' | 'empty' | 'skipped';

/** One summary mail. It throws when the send fails; the job tries again on its next run with the same key. */
export async function sendSummary(deps: Deps, userId: string, today: string): Promise<SummaryOutcome> {
  const [person] = await deps.db.statement<PersonRow>('read', USER_MAIL_SQL, [userId]);
  if (!person || !mailable(person) || !morningSummaryOn(person.preferences)) return 'skipped';
  const summary = await deps.db.tx('read', (q) => buildSummary(q, { id: userId }, today));
  if (!summary) return 'empty';
  const rendered = renderMail('summary', person.preferences.language, { ...summary, link: appLink(deps.config.appUrl, '/work') }, { reader: person.gender ?? undefined });
  const result = await sendWarned(deps, 'summary', mailOf(person.email, rendered, 'summary', `summary-${today}-${userId}`), userId);
  return result.status;
}
