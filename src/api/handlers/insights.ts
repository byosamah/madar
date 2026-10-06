import { involves } from '../../lib/taskPeople';
import { z } from 'zod';
import { defineCall } from '../registry';
import {
  ClientId, Day, Deadline, FileId, HealthValue, PauseKind, PaymentId, ProjectId, ProjectStatus, Stage, StageId, TaskId, TeamId, UserId, type Payment, type Project, type Task,
} from '../contract/entities';
import { UserCard } from '../contract/views';
import { computeHealth, isOverdue } from '../health';
import { pauseKindOf, peopleFilter, staleDaysOf } from '../pause';
import { reviewersOf } from '../notify';
import { can } from '../permissions';
import { sentToReviewOn } from '../review';
import { paymentsOf, trackerOf, type State } from '../store';
import { stageTag } from '../flow';
import { cardOf, deadlinesOf, stagesInTime, stagesOf, userCard } from '../views';
import { addDays, diffDays, maxDay, stampDay, weekStartOf } from '../../lib/dates';
import { normalizeForSearch } from '../../lib/text';
import { isOpen } from '../../lib/tracker';
import { isLive } from '../../lib/overview';
import { markOf } from '../../lib/projectMark';

const Count = z.number().int().min(0);
/** Payments not yet received: how many, their total in Saudi riyals, and each one, the soonest first. */
const MoneyRows = z.object({
  count: Count,
  total: z.number().nonnegative(),
  payments: z.array(z.object({ id: PaymentId, projectId: ProjectId, projectCode: z.string(), name: z.string(), amount: z.number().positive(), dueDate: Day })),
});
const Ref = z.object({ id: ProjectId, code: z.string(), name: z.string(), mark: z.number().int().nonnegative() });

export const DashboardView = z.object({
  tiles: z.object({
    activeProjects: Count,
    atRiskOrLate: Count,
    overdueTasks: Count,
    deadlinesNext14: Count,
    areaInDesign: z.number(),
    /** The active projects in design with no area, so a person knows the area in design reads low (owner, 2026-10-06). */
    inDesignWithoutArea: Count,
  }),
  charts: z.object({
    projectsPerStage: z.array(z.object({ stage: z.string(), count: Count })),
    healthMix: z.object({ on_track: Count, at_risk: Count, late: Count }),
    throughput: z.array(z.object({ weekStart: Day, created: Count, done: Count })).length(12),
    /** The Tracker entries that the office sent to the client (direction out), by their own date, for 12 weeks (owner, 2026-10-06). */
    submissions: z.array(z.object({ weekStart: Day, count: Count })).length(12),
  }),
  workload: z.object({
    weeks: z.array(Day).length(4),
    limit: Count,
    /**
     * overdue: the open tasks of the person that are past due (owner, 2026-10-06). counts: the open tasks due in each week, from
     * today on, so nothing counts twice; week 1 also holds the tasks in review that the person reviews (reviewersOf).
     */
    rows: z.array(z.object({ user: UserCard, overdue: Count, counts: z.array(Count).length(4), over: z.array(z.boolean()).length(4) })),
  }),
  schedule: z.array(z.object({
    project: Ref, currentStageId: StageId, health: HealthValue, stages: z.array(Stage), deadlines: z.array(Deadline),
    /** Set for a paused project (it shows when the status filter asks for paused projects): its kind, and the days it waited once stale. */
    pause: z.object({ kind: PauseKind, staleDays: Count.nullable() }).nullable(),
    /** The open client items of the project (Tracker loops): the ones that wait for our reply and the ones that wait for the client. */
    openLoops: z.object({ us: Count, client: Count }),
  })),
  /** The open client items that wait for the office's reply, for each active project in the filters, the most first (owner, 2026-10-06). */
  waitingForUs: z.array(z.object({ project: Ref, count: Count })),
  /**
   * The tasks in review of the active projects in the filters, one row for each reviewer (reviewersOf), the longest wait first.
   * days: whole days since the task last went to review, 0 when no change names it (owner, 2026-10-06).
   */
  inReview: z.array(z.object({
    reviewer: UserCard,
    count: Count,
    oldestDays: Count,
    tasks: z.array(z.object({ id: TaskId, title: z.string(), projectId: ProjectId, projectCode: z.string(), days: Count })),
  })),
  /**
   * The data gaps of the active projects in the filters, for the Admin only (can admin.manage): open tasks with no due date or no
   * lead, projects with a stage that has no end date, and projects with no area. Each count equals the list it opens. Null for
   * anyone else, and for an agent that acts for anyone else (owner, 2026-10-06).
   */
  gaps: z.object({ noDueDate: Count, noLead: Count, projectsStageNoEnd: Count, noArea: Count }).nullable(),
  /**
   * The payments not yet received, past due and due in the next 30 days, for the projects of the leader, client and team filters,
   * whatever their status: a paused or finished project still owes its money. Only for the people who may handle payments (can
   * payment.manage: Admin, Management, Accounting); null for anyone else, and for an agent that acts for anyone else (owner, 2026-10-06).
   */
  money: z.object({ pastDue: MoneyRows, next30: MoneyRows }).nullable(),
  /** What needs a look, whatever the status filter says: the paused projects that turned stale (colleague comment 16). */
  attention: z.object({
    stale: z.array(z.object({ project: Ref, days: Count, kind: PauseKind })),
  }),
  /**
   * The people who lead a project in the status ("all": an active or a paused project), for the Leader filter. The leader, client
   * and team filters do not apply here, so every choice stays in the list (audit 2026-10-03, F-14; cleanup 2026-10-06).
   */
  leaders: z.array(UserCard),
});
export type DashboardView = z.infer<typeof DashboardView>;



/** The data gaps of the active projects in scope: the Admin's list of what to fill in (owner, 2026-10-06). */
function gapsOf(state: State, active: Project[], activeTasks: Task[]) {
  const open = activeTasks.filter((t) => t.status !== 'done');
  return {
    noDueDate: open.filter((t) => t.dueDate === null).length,
    noLead: open.filter((t) => t.ownerId === null).length,
    // Projects, not stages: the number equals the projects.list filter stage_no_end that it opens (review, 2026-10-06).
    projectsStageNoEnd: active.filter((p) => stagesOf(state, p.id).some((stage) => stage.endDate === null)).length,
    noArea: active.filter((p) => p.areaM2 === null).length,
  };
}

/** The money that clients owe: past due, and due from today to 30 days from today (owner, 2026-10-06). */
function moneyOf(state: State, inFilters: (project: Project) => boolean, today: string) {
  const open = Object.values(paymentsOf(state))
    .filter((p) => p.receivedOn === null && state.projects[p.projectId] !== undefined && inFilters(state.projects[p.projectId]))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const rows = (list: Payment[]) => ({
    count: list.length,
    total: list.reduce((sum, p) => sum + p.amount, 0),
    payments: list.map((p) => ({ id: p.id, projectId: p.projectId, projectCode: state.projects[p.projectId].code, name: p.name, amount: p.amount, dueDate: p.dueDate })),
  });
  return {
    pastDue: rows(open.filter((p) => p.dueDate < today)),
    next30: rows(open.filter((p) => p.dueDate >= today && p.dueDate <= addDays(today, 30))),
  };
}

export const dashboardGet = defineCall({
  input: z.object({
    status: z.union([ProjectStatus, z.literal('all')]).default('active'),
    leaderId: UserId.optional(),
    clientId: ClientId.optional(),
    teamId: TeamId.optional(),
  }),
  output: DashboardView,
  readOnly: true,
  run(input, ctx) {
    const { state, today, authority: actor } = ctx;
    // The people filters apply to every number, and the lists that the numbers open take the same filters (owner, 2026-10-06).
    const inFilters = peopleFilter(state, input);
    const projects = Object.values(state.projects).filter((p) => (input.status === 'all' || p.status === input.status) && inFilters(p));
    const active = projects.filter((p) => p.status === 'active');
    const inScope = new Set(projects.map((p) => p.id));
    const activeIds = new Set(active.map((p) => p.id));
    const tasks = Object.values(state.tasks);
    const healths = active.map((p) => computeHealth({ project: p, stages: stagesOf(state, p.id), tasks: tasks.filter((t) => t.projectId === p.id) }, today));
    // The stage of a project follows its tasks (owner, 2026-10-02), so it is computed here and never read from the saved value.
    const tagOf = (p: Project) => stageTag(state, p.id);
    const healthOf = new Map(active.flatMap((p, i) => (healths[i] ? [[p.id, healths[i].value] as const] : [])));
    const healthMix = { on_track: 0, at_risk: 0, late: 0 };
    for (const health of healths) if (health) healthMix[health.value] += 1;

    const weekStart = weekStartOf(today);
    const humans = Object.values(state.users).filter((u) => u.kind === 'human' && u.active).sort((a, b) => a.name.localeCompare(b.name));
    const refOf = (p: Project) => ({ id: p.id, code: p.code, name: p.name, mark: markOf(p) });

    const order = state.settings.defaultStages;
    const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
    // A project is out of design when its stage tag is the last stage of its OWN list. A rename of the office list, an Arabic
    // list, or a name that only this project uses ("Site supervision") changes nothing (audit 2026-10-03, DSH-16, V-17).
    // The last stage is the last one of the list (the highest order), not the last in time, because a stage with no dates yet sorts
    // last in time. A project with one stage has no separate site stage, so it stays in design (audit 2026-10-03, V-17).
    const onSite = (p: Project) => {
      const own = stagesOf(state, p.id);
      return own.length > 1 && tagOf(p)?.id === own[own.length - 1].id;
    };
    const inDesign = active.filter((p) => !onSite(p));
    const perStage = new Map<string, number>();
    for (const p of active) {
      const name = tagOf(p)?.name ?? '';
      perStage.set(name, (perStage.get(name) ?? 0) + 1);
    }

    const scopedTasks = tasks.filter((t) => inScope.has(t.projectId));
    const throughput = Array.from({ length: 12 }, (_, i) => {
      const start = addDays(weekStart, (i - 11) * 7);
      const end = addDays(start, 6);
      const inWeek = (stamp: string | null) => stamp !== null && stampDay(stamp) >= start && stampDay(stamp) <= end;
      return { weekStart: start, created: scopedTasks.filter((t) => inWeek(t.createdAt)).length, done: scopedTasks.filter((t) => inWeek(t.completedAt)).length };
    });

    const sent = Object.values(trackerOf(state)).filter((entry) => entry.direction === 'out' && inScope.has(entry.projectId));
    const submissions = throughput.map(({ weekStart: start }) => ({
      weekStart: start, count: sent.filter((entry) => entry.date >= start && entry.date <= addDays(start, 6)).length,
    }));

    // The open client items of each project, for the meeting agenda.
    const loops = new Map<string, { us: number; client: number }>();
    for (const entry of Object.values(trackerOf(state))) {
      if (!isOpen(entry) || entry.waiting === null) continue;
      const count = loops.get(entry.projectId) ?? { us: 0, client: 0 };
      count[entry.waiting] += 1;
      loops.set(entry.projectId, count);
    }

    const inStatus = (p: Project) => (input.status === 'all' ? isLive(p.status) : p.status === input.status);
    const leaderIds = new Set(Object.values(state.projects).filter(inStatus).flatMap((p) => (p.leaderId ? [p.leaderId] : [])));
    const leaders = [...leaderIds].map((id) => cardOf(state, id)).sort((a, b) => a.name.localeCompare(b.name));

    const weeks = Array.from({ length: 4 }, (_, i) => addDays(weekStart, i * 7));
    const limit = state.settings.workloadLimit;
    const activeTasks = tasks.filter((t) => activeIds.has(t.projectId));
    // A task in review is work for its reviewers, not for the person who finished it (owner, 2026-10-06).
    const reviewing = activeTasks.filter((task) => task.status === 'in_review');
    const sentOn = sentToReviewOn(state, new Set(reviewing.map((task) => task.id)));
    const reviews = new Map<string, { id: string; title: string; projectId: string; projectCode: string; days: number }[]>();
    for (const task of reviewing) {
      const sent = sentOn.get(task.id);
      const row = { id: task.id, title: task.title, projectId: task.projectId, projectCode: state.projects[task.projectId].code, days: sent ? Math.max(0, diffDays(sent, today)) : 0 };
      for (const id of reviewersOf(state, task.projectId)) reviews.set(id, [...(reviews.get(id) ?? []), row]);
    }
    const reviewsOf = new Map([...reviews].map(([id, rows]) => [id, rows.length]));
    const workloadRows = humans.map((user) => {
      // A person's tasks are the ones they lead or help on: the same rule as the Task list each cell opens (audit PER-4).
      const own = activeTasks.filter((t) => involves(t, user.id));
      // Past due from day 1, the rule of the "Past-due tasks" number. The weeks start today, so a past-due task counts once.
      const overdue = own.filter((t) => isOverdue(t, today)).length;
      const counts = weeks.map((ws, i) => {
        const from = maxDay(ws, today);
        const due = own.filter((t) => (t.status === 'todo' || t.status === 'in_progress') && t.dueDate !== null && t.dueDate >= from && t.dueDate <= addDays(ws, 6)).length;
        return due + (i === 0 ? reviewsOf.get(user.id) ?? 0 : 0);
      });
      return { user: userCard(user), overdue, counts, over: counts.map((count) => count > limit) };
    });

    return {
      tiles: {
        activeProjects: active.length,
        atRiskOrLate: healths.filter((h) => h !== null && h.value !== 'on_track').length,
        overdueTasks: tasks.filter((t) => activeIds.has(t.projectId) && isOverdue(t, today)).length,
        deadlinesNext14: Object.values(state.deadlines).filter((d) => activeIds.has(d.projectId) && d.date >= today && d.date <= addDays(today, 14)).length,
        areaInDesign: inDesign.reduce((sum, p) => sum + (p.areaM2 ?? 0), 0),
        inDesignWithoutArea: inDesign.filter((p) => p.areaM2 === null).length,
      },
      charts: {
        projectsPerStage: [...perStage.entries()]
          .map(([stage, count]) => ({ stage, count }))
          .sort((a, b) => rank(a.stage) - rank(b.stage) || a.stage.localeCompare(b.stage)),
        healthMix,
        throughput,
        submissions,
      },
      workload: { weeks, limit, rows: workloadRows },
      attention: {
        stale: Object.values(state.projects)
          .filter(inFilters)
          .flatMap((p) => { const days = staleDaysOf(state, p, today); return days === null ? [] : [{ project: refOf(p), days, kind: pauseKindOf(p) }]; })
          .sort((a, b) => b.days - a.days || a.project.name.localeCompare(b.project.name)),
      },
      schedule: [...active, ...projects.filter((p) => p.status === 'on_hold')]
        .sort((a, b) => (a.targetEndDate ?? '9999-12-31').localeCompare(b.targetEndDate ?? '9999-12-31') || a.code.localeCompare(b.code))
        .map((p) => ({
          project: refOf(p), currentStageId: tagOf(p)?.id ?? p.currentStageId, health: healthOf.get(p.id) ?? 'on_track', stages: stagesInTime(state, p.id), deadlines: deadlinesOf(state, p.id),
          pause: p.status === 'on_hold' ? { kind: pauseKindOf(p), staleDays: staleDaysOf(state, p, today) } : null,
          openLoops: loops.get(p.id) ?? { us: 0, client: 0 },
        })),
      inReview: [...reviews]
        .map(([id, rows]) => {
          const ordered = [...rows].sort((a, b) => b.days - a.days || a.title.localeCompare(b.title));
          return { reviewer: cardOf(state, id), count: rows.length, oldestDays: ordered[0].days, tasks: ordered };
        })
        .sort((a, b) => b.oldestDays - a.oldestDays || b.count - a.count || a.reviewer.name.localeCompare(b.reviewer.name)),
      gaps: can(actor, 'admin.manage') ? gapsOf(state, active, activeTasks) : null,
      money: can(actor, 'payment.manage') ? moneyOf(state, inFilters, today) : null,
      waitingForUs: active
        .flatMap((p) => { const count = loops.get(p.id)?.us ?? 0; return count > 0 ? [{ project: refOf(p), count }] : []; })
        .sort((a, b) => b.count - a.count || a.project.name.localeCompare(b.project.name)),
      leaders,
    };
  },
});

export const SearchView = z.object({
  projects: z.array(Ref).max(5),
  tasks: z.array(z.object({ id: TaskId, title: z.string(), projectId: ProjectId, projectCode: z.string() })).max(5),
  people: z.array(UserCard).max(5),
  files: z.array(z.object({ id: FileId, name: z.string(), projectId: ProjectId, projectCode: z.string() })).max(5),
});

export const searchQuery = defineCall({
  input: z.object({ text: z.string().trim().min(1).max(100) }),
  output: SearchView,
  readOnly: true,
  run(input, ctx) {
    const { state } = ctx;
    // A project link in a post reads "#KH-26-001" and a mention "@Name", so Search drops that first mark (audit PER-3).
    const query = normalizeForSearch(input.text.replace(/^[#@]+/, ''));
    if (!query) return { projects: [], tasks: [], people: [], files: [] };
    const hit = (...parts: (string | undefined)[]) => normalizeForSearch(parts.filter(Boolean).join(' ')).includes(query);
    const codeOf = (projectId: string) => state.projects[projectId]?.code ?? '';
    return {
      projects: Object.values(state.projects)
        .filter((p) => hit(p.code, p.name, p.clientId ? state.clients[p.clientId]?.name : undefined, p.clientId ? state.clients[p.clientId]?.nameAr : undefined))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 5)
        .map((p) => ({ id: p.id, code: p.code, name: p.name, mark: markOf(p) })),
      tasks: Object.values(state.tasks)
        .filter((t) => state.projects[t.projectId]?.status === 'active' && hit(t.title))
        .slice(0, 5)
        .map((t) => ({ id: t.id, title: t.title, projectId: t.projectId, projectCode: codeOf(t.projectId) })),
      people: Object.values(state.users)
        .filter((u) => u.active && hit(u.name, u.nameAr, u.discipline))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 5)
        .map((u) => userCard(u)),
      files: Object.values(state.files)
        .filter((f) => hit(f.name))
        .slice(0, 5)
        .map((f) => ({ id: f.id, name: f.name, projectId: f.projectId, projectCode: codeOf(f.projectId) })),
    };
  },
});

export const insightCalls = {
  'dashboard.get': dashboardGet,
  'search.query': searchQuery,
};
