import { involves } from '../../lib/taskPeople';
import { z } from 'zod';
import { defineCall } from '../registry';
import {
  ClientId, Day, Deadline, FileId, HealthValue, PauseKind, ProjectId, ProjectStatus, Stage, StageId, TaskId, TeamId, UserId, type Project,
} from '../contract/entities';
import { UserCard } from '../contract/views';
import { computeHealth, isOverdue } from '../health';
import { pauseKindOf, staleDaysOf, teamFilter } from '../pause';
import { trackerOf, type State } from '../store';
import { stageTag } from '../flow';
import { deadlinesOf, stagesInTime, stagesOf, userCard } from '../views';
import { addDays, stampDay, weekStartOf } from '../../lib/dates';
import { normalizeForSearch } from '../../lib/text';
import { isOpen } from '../../lib/tracker';
import { markOf } from '../../lib/projectMark';

const Count = z.number().int().min(0);
const Ref = z.object({ id: ProjectId, code: z.string(), name: z.string(), mark: z.number().int().nonnegative() });

export const DashboardView = z.object({
  tiles: z.object({
    activeProjects: Count,
    atRiskOrLate: Count,
    overdueTasks: Count,
    deadlinesNext14: Count,
    areaInDesign: z.number(),
  }),
  charts: z.object({
    projectsPerStage: z.array(z.object({ stage: z.string(), count: Count })),
    healthMix: z.object({ on_track: Count, at_risk: Count, late: Count }),
    throughput: z.array(z.object({ weekStart: Day, created: Count, done: Count })).length(12),
  }),
  workload: z.object({
    weeks: z.array(Day).length(4),
    limit: Count,
    rows: z.array(z.object({ user: UserCard, counts: z.array(Count).length(4), over: z.array(z.boolean()).length(4) })),
  }),
  schedule: z.array(z.object({
    project: Ref, currentStageId: StageId, health: HealthValue, stages: z.array(Stage), deadlines: z.array(Deadline),
    /** Set for a paused project (it shows when the status filter asks for paused projects): its kind, and the days it waited once stale. */
    pause: z.object({ kind: PauseKind, staleDays: Count.nullable() }).nullable(),
    /** The open client items of the project (Tracker loops): the ones that wait for our reply and the ones that wait for the client. */
    openLoops: z.object({ us: Count, client: Count }),
  })),
  /** What needs a look, whatever the status filter says: the paused projects that turned stale (colleague comment 16). */
  attention: z.object({
    stale: z.array(z.object({ project: Ref, days: Count, kind: PauseKind })),
  }),
});
export type DashboardView = z.infer<typeof DashboardView>;



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
    const inTeam = teamFilter(state, input.teamId);
    // The people filters apply to every number.
    const inFilters = (p: Project) => (!input.leaderId || p.leaderId === input.leaderId) && (!input.clientId || p.clientId === input.clientId) && inTeam(p);
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

    // The open client items of each project, for the meeting agenda.
    const loops = new Map<string, { us: number; client: number }>();
    for (const entry of Object.values(trackerOf(state))) {
      if (!isOpen(entry) || entry.waiting === null) continue;
      const count = loops.get(entry.projectId) ?? { us: 0, client: 0 };
      count[entry.waiting] += 1;
      loops.set(entry.projectId, count);
    }

    const weeks = Array.from({ length: 4 }, (_, i) => addDays(weekStart, i * 7));
    const limit = state.settings.workloadLimit;
    const workloadRows = humans.map((user) => {
      // A person's tasks are the ones they lead or help on: the same rule as the Task list this number opens (audit PER-4).
      const counts = weeks.map((ws) => tasks.filter((t) =>
        involves(t, user.id) && t.status !== 'done' && t.dueDate !== null && t.dueDate >= ws && t.dueDate <= addDays(ws, 6) && activeIds.has(t.projectId)).length);
      return { user: userCard(user), counts, over: counts.map((count) => count > limit) };
    });

    return {
      tiles: {
        activeProjects: active.length,
        atRiskOrLate: healths.filter((h) => h !== null && h.value !== 'on_track').length,
        overdueTasks: tasks.filter((t) => activeIds.has(t.projectId) && isOverdue(t, today)).length,
        deadlinesNext14: Object.values(state.deadlines).filter((d) => activeIds.has(d.projectId) && d.date >= today && d.date <= addDays(today, 14)).length,
        areaInDesign: active.filter((p) => !onSite(p)).reduce((sum, p) => sum + (p.areaM2 ?? 0), 0),
      },
      charts: {
        projectsPerStage: [...perStage.entries()]
          .map(([stage, count]) => ({ stage, count }))
          .sort((a, b) => rank(a.stage) - rank(b.stage) || a.stage.localeCompare(b.stage)),
        healthMix,
        throughput,
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
