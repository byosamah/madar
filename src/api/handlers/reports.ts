import { z } from 'zod';
import { stampDay } from '../../lib/dates';
import { markOf } from '../../lib/projectMark';
import { Day, type Event, type Payment, type Project, type Task, type TrackerEntry } from '../contract/entities';
import { OfficeReport, type ReportPerson, type ReportProject } from '../contract/views';
import { computeHealth } from '../health';
import { can } from '../permissions';
import { REPORT_DESIGN } from '../reportDesign';
import {
  periodRange, REPORT_COMPLETED_VERB, REPORT_KEYS, REPORT_PAUSED_VERB, REPORT_REVIEW_VERBS, REPORT_STAGE_VERB, ReportPeriodKind, type DayRange,
} from '../reportPeriod';
import { defineCall, type Ctx } from '../registry';
import { paymentsOf, trackerOf, type State } from '../store';
import { stagesOf, userCard } from '../views';
import { assertCan } from './shared';

/**
 * The office report of one period (owner, 2026-10-18, fbk_016). Only the right "report.office" reads it. The right
 * "payment.manage" gives the money. The right "admin.manage" gives the gaps.
 *
 * Counting rules. The report reads the office as it is now, with the dates of each record.
 * - A task is made on the day it was created. It is done on the day it was completed.
 * - A task is open at the end of a day when it was created on or before that day, and was not completed by then.
 * - A task is past due at the end when it is open at the end and its due date is before the end.
 * - Tasks, deadlines and payments count for the projects of the office. Office tasks stay out, because they are private.
 * - A deadline counts when its day is in the period and is not after today. It is missed when a task of its project, due on or
 *   before the deadline day, is open at the end of the period. Otherwise it is met.
 * - A Tracker entry is opened on its own day. It is closed on the day it was closed. A submission is an entry sent to the client.
 * - A project's health is the health of today. The State keeps no history of it.
 * - The stage at the start and at the end is the stage whose dates hold that day.
 * - Stage moves, completions and pauses come from the events of the period. The loader counts them in SQL (State.counts,
 *   REPORT_KEYS). Without those counts, the handler counts the events in its State (the prototype).
 * - The reviews of a person come from the review events of the period in the State (REPORT_REVIEW_VERBS). The loader reads them once.
 */

/** The office name of the report. The office has no name field yet, so the product name stands in. */
const OFFICE_NAME = 'Madar';

/** The most project rows of one report (the schema). The totals still count every project. */
const MAX_PROJECTS = 200;

/** The status of an event after its change, when the change sets a status. */
function statusAfter(event: Event): unknown {
  const after = event.after as { status?: unknown } | null | undefined;
  return after?.status;
}

/** The report of one period, from the State of the call. */
function buildReport(ctx: Ctx, input: { period: ReportPeriodKind; start?: string }) {
  const { state, today, authority: actor } = ctx;
  const range: DayRange = periodRange(input.period, input.start, today);
  const inDays = (day: string | null | undefined): boolean => typeof day === 'string' && day >= range.from && day <= range.to;
  const dayOf = (stamp: string | null): string | null => (stamp === null ? null : stampDay(stamp));

  const projects = Object.values(state.projects).sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
  const tasks = Object.values(state.tasks).filter((task) => task.projectId !== null && state.projects[task.projectId] !== undefined);
  const deadlines = Object.values(state.deadlines).filter((deadline) => state.projects[deadline.projectId] !== undefined);
  const trackerRows = Object.values(trackerOf(state)).filter((entry) => state.projects[entry.projectId] !== undefined);
  const payments = Object.values(paymentsOf(state)).filter((payment) => state.projects[payment.projectId] !== undefined);
  const events = Object.values(state.events);

  const madeIn = (task: Task) => inDays(stampDay(task.createdAt));
  const doneIn = (task: Task) => inDays(dayOf(task.completedAt));
  const openAtEnd = (task: Task) => {
    const completedDay = dayOf(task.completedAt);
    return stampDay(task.createdAt) <= range.to && (completedDay === null || completedDay > range.to);
  };
  const pastDueAtEnd = (task: Task) => openAtEnd(task) && task.dueDate !== null && task.dueDate < range.to;

  /** A count from State.counts when a loader put one there, else a scan of the events of the state. */
  const count = (key: string, scan: () => number): number => state.counts?.[key] ?? scan();
  const eventsOf = (verb: string): Event[] => events.filter((event) => event.verb === verb && inDays(dayOf(event.createdAt)));
  const stageMoves = count(REPORT_KEYS.stageMoves, () => eventsOf(REPORT_STAGE_VERB).length);
  const completedIn = (projectId: string) => count(REPORT_KEYS.completed(projectId), () => eventsOf(REPORT_COMPLETED_VERB)
    .filter((event) => event.projectId === projectId && statusAfter(event) === 'completed').length);
  const pausedIn = (projectId: string) => count(REPORT_KEYS.paused(projectId), () => eventsOf(REPORT_PAUSED_VERB)
    .filter((event) => event.projectId === projectId).length);
  const reviewVerbs: readonly string[] = REPORT_REVIEW_VERBS;
  const reviewEvents = events.filter((event) => reviewVerbs.includes(event.verb) && inDays(dayOf(event.createdAt)));
  const reviewsOf = (userId: string) => reviewEvents.filter((event) => event.actingForId === userId).length;

  /** The deadlines of a project that are due in the period and no later than today, each met or missed. */
  const dueDeadlines = (projectId: string) => deadlines.filter((deadline) => deadline.projectId === projectId && inDays(deadline.date) && deadline.date <= today);
  const deadlinesOf = (projectId: string) => {
    const own = tasks.filter((task) => task.projectId === projectId);
    const due = dueDeadlines(projectId);
    const missed = due.filter((deadline) => own.some((task) => openAtEnd(task) && task.dueDate !== null && task.dueDate <= deadline.date)).length;
    return { met: due.length - missed, missed };
  };
  const stageOn = (projectId: string, day: string) => {
    const stage = stagesOf(state, projectId).find((one) => one.startDate !== null && one.endDate !== null && one.startDate <= day && day <= one.endDate);
    return stage ? { id: stage.id, name: stage.name } : null;
  };

  const projectRow = (project: Project): ReportProject => {
    const own = tasks.filter((task) => task.projectId === project.id);
    const deadlineCounts = deadlinesOf(project.id);
    const next = deadlines
      .filter((deadline) => deadline.projectId === project.id && deadline.date > range.to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0];
    const health = computeHealth({ project, stages: stagesOf(state, project.id), tasks: own }, today);
    return {
      project: { id: project.id, code: project.code, name: project.name, mark: markOf(project) },
      status: project.status,
      stageAtStart: stageOn(project.id, range.from),
      stageAtEnd: stageOn(project.id, range.to),
      health: health?.value ?? null,
      tasks: { done: own.filter(doneIn).length, made: own.filter(madeIn).length, pastDueAtEnd: own.filter(pastDueAtEnd).length },
      deadlines: deadlineCounts,
      nextDeadline: next ? { name: next.name, date: next.date } : null,
    };
  };
  const rows = projects.map(projectRow);
  // A project row shows when the project is live, or when the period holds a change of it.
  const shown = rows.filter((row) => {
    const changes = row.tasks.done + row.tasks.made + row.deadlines.met + row.deadlines.missed + completedIn(row.project.id) + pausedIn(row.project.id);
    return row.status === 'active' || row.status === 'on_hold' || changes > 0;
  });

  const people: ReportPerson[] = Object.values(state.users)
    .filter((user) => user.kind === 'human' && user.active && !user.removed)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((user) => ({
      user: userCard(user),
      tasksDone: tasks.filter((task) => task.ownerId === user.id && doneIn(task)).length,
      open: tasks.filter((task) => task.ownerId === user.id && openAtEnd(task)).length,
      pastDue: tasks.filter((task) => task.ownerId === user.id && pastDueAtEnd(task)).length,
      reviewsDone: reviewsOf(user.id),
    }));

  const money = can(actor, 'payment.manage') ? moneyOf(payments, range) : null;
  const gaps = can(actor, 'admin.manage') ? gapsOf(state, tasks, projects) : null;

  return {
    period: { kind: input.period, from: range.from, to: range.to },
    generatedAt: ctx.stamp,
    office: { name: OFFICE_NAME },
    totals: {
      projects: {
        active: projects.filter((project) => project.status === 'active').length,
        started: projects.filter((project) => inDays(project.startDate)).length,
        completed: projects.filter((project) => completedIn(project.id) > 0).length,
        paused: projects.filter((project) => pausedIn(project.id) > 0).length,
      },
      tasks: { done: tasks.filter(doneIn).length, made: tasks.filter(madeIn).length, pastDueAtEnd: tasks.filter(pastDueAtEnd).length },
      deadlines: rows.reduce((sum, row) => ({ met: sum.met + row.deadlines.met, missed: sum.missed + row.deadlines.missed }), { met: 0, missed: 0 }),
      submissions: trackerRows.filter((entry) => entry.direction === 'out' && inDays(entry.date)).length,
      stageMoves,
    },
    projects: shown.slice(0, MAX_PROJECTS),
    people,
    tracker: trackerCounts(trackerRows, range),
    money,
    gaps,
    design: REPORT_DESIGN,
  };
}

/** The money of the period, in Saudi riyals (only for the people who handle payments). */
function moneyOf(payments: Payment[], range: DayRange) {
  const sum = (list: Payment[]) => list.reduce((total, payment) => total + payment.amount, 0);
  const receivedByEnd = (payment: Payment) => payment.receivedOn !== null && payment.receivedOn <= range.to;
  return {
    received: sum(payments.filter((payment) => payment.receivedOn !== null && payment.receivedOn >= range.from && payment.receivedOn <= range.to)),
    dueInPeriod: sum(payments.filter((payment) => payment.dueDate >= range.from && payment.dueDate <= range.to && !receivedByEnd(payment))),
    pastDueAtEnd: sum(payments.filter((payment) => payment.dueDate < range.to && !receivedByEnd(payment))),
  };
}

/** The Tracker counts: opened and closed in the period, and the entries that wait for the client at the end. */
function trackerCounts(entries: TrackerEntry[], range: DayRange) {
  const closedDay = (entry: TrackerEntry) => (entry.closedAt === null ? null : stampDay(entry.closedAt));
  const closedInPeriod = (entry: TrackerEntry) => {
    const day = closedDay(entry);
    return day !== null && day >= range.from && day <= range.to;
  };
  const openAtEnd = (entry: TrackerEntry) => {
    const day = closedDay(entry);
    return entry.date <= range.to && (day === null || day > range.to);
  };
  return {
    opened: entries.filter((entry) => entry.date >= range.from && entry.date <= range.to).length,
    closed: entries.filter(closedInPeriod).length,
    waitingOnClientAtEnd: entries.filter((entry) => entry.waiting === 'client' && openAtEnd(entry)).length,
  };
}

/** The data gaps of the office, for the Admin: each line counts one gap, and a line shows only when it counts. */
function gapsOf(state: State, tasks: Task[], projects: Project[]): string[] {
  const open = tasks.filter((task) => task.status !== 'done');
  const active = projects.filter((project) => project.status === 'active');
  const noStageEnd = active.filter((project) => stagesOf(state, project.id).some((stage) => stage.endDate === null)).length;
  const counts: [string, number][] = [
    ['Open tasks with no due date', open.filter((task) => task.dueDate === null).length],
    ['Open tasks with no lead', open.filter((task) => task.ownerId === null).length],
    ['Active projects with a stage that has no end date', noStageEnd],
    ['Active projects with no area', active.filter((project) => project.areaM2 === null).length],
  ];
  return counts.filter(([, n]) => n > 0).map(([label, n]) => `${label}: ${n}`);
}

export const reportsOffice = defineCall({
  input: z.object({ period: ReportPeriodKind, start: Day.optional() }),
  output: OfficeReport,
  readOnly: true,
  run(input, ctx) {
    assertCan(ctx, 'report.office');
    return buildReport(ctx, input);
  },
});

export const reportsCalls = {
  'reports.office': reportsOffice,
};
