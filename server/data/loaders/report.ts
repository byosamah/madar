import { can } from '../../../src/api/permissions';
import {
  periodRange, periodStamps, REPORT_COMPLETED_VERB, REPORT_KEYS, REPORT_PAUSED_VERB, REPORT_REVIEW_VERBS, REPORT_STAGE_VERB, type ReportPeriodKind,
} from '../../../src/api/reportPeriod';
import { todayISO } from '../../../src/lib/dates';
import type { Cond } from './query';
import type { Load } from './build';
import { DASHBOARD_TASK_FIELDS } from './overview';
import { tasksOf } from './steps';

type Input = { period: ReportPeriodKind; start?: string };

/**
 * reports.office (owner, 2026-10-18, fbk_016). The loader reads the rows and the counts of the period of the call.
 *
 * Rows: every task of the projects, because a task has no date column and the handler counts the days. Every Tracker entry of the
 * projects. The payments of the projects, for the people with the payment right. The office lists come from the snapshot.
 * Office tasks stay out.
 *
 * Counts: the stage moves, completions and pauses of the period, counted in SQL, one count for each key (REPORT_KEYS). The reviews
 * of the period load as event rows of the projects (five fields each), and the handler counts them for each person through the person
 * who acted for (actingForId). One read for all people, never one count for each person. An office task has no project, so its
 * reviews stay out.
 *
 * The period needs today. The loader gets it from LoadCtx.now, the same time as the handler. Without that time, it throws.
 */
export async function reportsOffice(L: Load, input: Input): Promise<void> {
  if (!L.authority || !can(L.authority, 'report.office')) return;
  if (!L.now) throw new Error('reports.office needs the time of the call (LoadCtx.now).');
  const range = periodRange(input.period, input.start, todayISO(L.now));
  const { from, until } = periodStamps(range);
  const ids = Object.keys(L.office.projects);

  await tasksOf(L, ids, DASHBOARD_TASK_FIELDS);
  await L.select({ c: 'tracker', where: [{ col: 'project_id', in: ids }] });
  if (can(L.authority, 'payment.manage')) await L.select({ c: 'payments', where: [{ col: 'project_id', in: ids }] });

  // The events of the period: created on or after the first instant of the first day, and before the first instant of the day after.
  const time: Cond[] = [{ col: 'created_at', atOrAfter: from }, { col: 'created_at', atBefore: until }];
  await L.countWhere({ c: 'events', per: 'verb', where: [{ col: 'verb', in: [REPORT_STAGE_VERB] }, ...time] }, [REPORT_STAGE_VERB], () => REPORT_KEYS.stageMoves);
  await L.countWhere({
    c: 'events', per: 'project_id', where: [{ col: 'verb', in: [REPORT_COMPLETED_VERB] }, { field: 'after', key: 'status', in: ['completed'] }, ...time],
  }, ids, (projectId) => REPORT_KEYS.completed(projectId));
  await L.countWhere({ c: 'events', per: 'project_id', where: [{ col: 'verb', in: [REPORT_PAUSED_VERB] }, ...time] }, ids, (projectId) => REPORT_KEYS.paused(projectId));
  await L.select({
    c: 'events', where: [{ col: 'verb', in: [...REPORT_REVIEW_VERBS] }, { col: 'project_id', in: ids }, ...time],
    pick: ['id', 'verb', 'actingForId', 'projectId', 'createdAt'],
  });
}
