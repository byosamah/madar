import { can } from '../../../src/api/permissions';
import {
  periodStamps, REPORT_COMPLETED_VERB, REPORT_KEYS, REPORT_PAUSED_VERB, REPORT_REVIEW_VERBS, REPORT_STAGE_VERB, reportRange, type ReportPick,
} from '../../../src/api/reportPeriod';
import { todayISO } from '../../../src/lib/dates';
import type { Cond } from './query';
import type { Load } from './build';
import { DASHBOARD_TASK_FIELDS } from './overview';
import { eventProjectConds, tasksOf, visibleProjects } from './steps';

type Input = ReportPick & { subCompanyId?: string };

/**
 * The Tracker fields that the report counts (reports.ts, trackerCounts and the submissions): the project, the side, the day, who it
 * waits for and when it closed. The report never saves, so it loads only these (performance audit DB-10, perf2).
 */
export const REPORT_TRACKER_FIELDS = ['id', 'projectId', 'direction', 'date', 'waiting', 'closedAt'] as const;

/**
 * reports.office (owner, 2026-10-18, fbk_016). The loader reads the rows and the counts of the period of the call.
 *
 * Rows: every task of the projects, because a task has no date column and the handler counts the days. Every Tracker entry of the
 * projects. The payments of the projects, for the people with the payment right. The office lists come from the snapshot.
 * Office tasks stay out.
 *
 * Counts: the stage moves, completions and pauses of the period, counted in SQL, one count for each key (REPORT_KEYS). The reviews
 * of the period load as event rows of the projects (five fields each). The handler counts them for each person through the person
 * who acted for (actingForId). One read for all people, never one count for each person. An office task has no project, so its
 * reviews stay out.
 *
 * The period needs today. The loader gets it from LoadCtx.now, the same time as the handler. Without that time, it throws.
 */
export async function reportsOffice(L: Load, input: Input): Promise<void> {
  if (!L.authority || !can(L.authority, 'report.office')) return;
  if (!L.now) throw new Error('reports.office needs the time of the call (LoadCtx.now).');
  const range = reportRange(input, todayISO(L.now));
  const { from, until } = periodStamps(range);
  // A sub-company filter reads only its projects (INT-09). Without it, every project that the person sees (hidden projects, owner 2026-10-22).
  const ids = visibleProjects(L).filter((project) => !input.subCompanyId || project.subCompanyId === input.subCompanyId).map((project) => project.id);

  await tasksOf(L, ids, DASHBOARD_TASK_FIELDS);
  await L.select({ c: 'tracker', where: [{ col: 'project_id', in: ids }], pick: REPORT_TRACKER_FIELDS });
  if (can(L.authority, 'payment.view')) await L.select({ c: 'payments', where: [{ col: 'project_id', in: ids }] });

  // The events of the period: created on or after the first instant of the first day, and before the first instant of the day after.
  const time: Cond[] = [{ col: 'created_at', atOrAfter: from }, { col: 'created_at', atBefore: until }];
  // The office count leaves out the projects that the person does not see, and the deleted projects that the person did not see (the handler: eventProjectViewer).
  await L.countWhere({ c: 'events', per: 'verb', where: [{ col: 'verb', in: [REPORT_STAGE_VERB] }, ...time, ...await eventProjectConds(L)] }, [REPORT_STAGE_VERB], () => REPORT_KEYS.stageMoves);
  // The stage moves of each project, only when the report names a sub-company: the office count above covers every project.
  if (input.subCompanyId) {
    await L.countWhere({ c: 'events', per: 'project_id', where: [{ col: 'verb', in: [REPORT_STAGE_VERB] }, ...time] }, ids, (projectId) => REPORT_KEYS.stageMovesOf(projectId));
  }
  await L.countWhere({
    c: 'events', per: 'project_id', where: [{ col: 'verb', in: [REPORT_COMPLETED_VERB] }, { field: 'after', key: 'status', in: ['completed'] }, ...time],
  }, ids, (projectId) => REPORT_KEYS.completed(projectId));
  await L.countWhere({ c: 'events', per: 'project_id', where: [{ col: 'verb', in: [REPORT_PAUSED_VERB] }, ...time] }, ids, (projectId) => REPORT_KEYS.paused(projectId));
  // No project filter here: a long list of projects makes SQLite scan the period once for each project. The handler drops the events of other projects.
  await L.select({
    c: 'events', where: [{ col: 'verb', in: [...REPORT_REVIEW_VERBS] }, ...time],
    pick: ['id', 'verb', 'actingForId', 'projectId', 'createdAt'],
  });
}
