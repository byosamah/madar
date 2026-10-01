import { z } from 'zod';
import { defineCall } from '../registry';
import {
  ClientId, Day, Deadline, FileId, HealthValue, ProjectId, ProjectStatus, Stage, StageId, TaskId, UserId, type Project,
} from '../contract/entities';
import { UserCard } from '../contract/views';
import { computeHealth, isOverdue } from '../health';
import type { State } from '../store';
import { deadlinesOf, stagesOf, userCard } from '../views';
import { addDays, stampDay, weekStartOf } from '../../lib/dates';
import { normalizeForSearch } from '../../lib/text';
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
  schedule: z.array(z.object({ project: Ref, currentStageId: StageId, health: HealthValue, stages: z.array(Stage), deadlines: z.array(Deadline) })),
});
export type DashboardView = z.infer<typeof DashboardView>;



export const dashboardGet = defineCall({
  input: z.object({
    status: z.union([ProjectStatus, z.literal('all')]).default('active'),
    leaderId: UserId.optional(),
    clientId: ClientId.optional(),
  }),
  output: DashboardView,
  readOnly: true,
  run(input, ctx) {
    const { state, today, authority: actor } = ctx;
    const projects = Object.values(state.projects).filter((p) =>
      (input.status === 'all' || p.status === input.status) && (!input.leaderId || p.leaderId === input.leaderId) && (!input.clientId || p.clientId === input.clientId));
    const active = projects.filter((p) => p.status === 'active');
    const inScope = new Set(projects.map((p) => p.id));
    const activeIds = new Set(active.map((p) => p.id));
    const tasks = Object.values(state.tasks);
    const healths = active.map((p) => computeHealth({ project: p, stages: stagesOf(state, p.id), tasks: tasks.filter((t) => t.projectId === p.id) }, today));
    const healthOf = new Map(active.flatMap((p, i) => (healths[i] ? [[p.id, healths[i].value] as const] : [])));
    const healthMix = { on_track: 0, at_risk: 0, late: 0 };
    for (const health of healths) if (health) healthMix[health.value] += 1;

    const weekStart = weekStartOf(today);
    const humans = Object.values(state.users).filter((u) => u.kind === 'human' && u.active).sort((a, b) => a.name.localeCompare(b.name));
    const refOf = (p: Project) => ({ id: p.id, code: p.code, name: p.name, mark: markOf(p) });

    const order = state.settings.defaultStages;
    const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
    const perStage = new Map<string, number>();
    for (const p of active) {
      const name = state.stages[p.currentStageId]?.name ?? '';
      perStage.set(name, (perStage.get(name) ?? 0) + 1);
    }

    const scopedTasks = tasks.filter((t) => inScope.has(t.projectId));
    const throughput = Array.from({ length: 12 }, (_, i) => {
      const start = addDays(weekStart, (i - 11) * 7);
      const end = addDays(start, 6);
      const inWeek = (stamp: string | null) => stamp !== null && stampDay(stamp) >= start && stampDay(stamp) <= end;
      return { weekStart: start, created: scopedTasks.filter((t) => inWeek(t.createdAt)).length, done: scopedTasks.filter((t) => inWeek(t.completedAt)).length };
    });

    const weeks = Array.from({ length: 4 }, (_, i) => addDays(weekStart, i * 7));
    const limit = state.settings.workloadLimit;
    const workloadRows = humans.map((user) => {
      const counts = weeks.map((ws) => tasks.filter((t) =>
        t.ownerId === user.id && t.status !== 'done' && t.dueDate !== null && t.dueDate >= ws && t.dueDate <= addDays(ws, 6) && activeIds.has(t.projectId)).length);
      return { user: userCard(user), counts, over: counts.map((count) => count > limit) };
    });

    return {
      tiles: {
        activeProjects: active.length,
        atRiskOrLate: healths.filter((h) => h !== null && h.value !== 'on_track').length,
        overdueTasks: tasks.filter((t) => activeIds.has(t.projectId) && isOverdue(t, today)).length,
        deadlinesNext14: Object.values(state.deadlines).filter((d) => activeIds.has(d.projectId) && d.date >= today && d.date <= addDays(today, 14)).length,
        areaInDesign: active.filter((p) => state.stages[p.currentStageId]?.name !== 'Supervision').reduce((sum, p) => sum + (p.areaM2 ?? 0), 0),
      },
      charts: {
        projectsPerStage: [...perStage.entries()]
          .map(([stage, count]) => ({ stage, count }))
          .sort((a, b) => rank(a.stage) - rank(b.stage) || a.stage.localeCompare(b.stage)),
        healthMix,
        throughput,
      },
      workload: { weeks, limit, rows: workloadRows },
      schedule: [...active]
        .sort((a, b) => (a.targetEndDate ?? '9999-12-31').localeCompare(b.targetEndDate ?? '9999-12-31') || a.code.localeCompare(b.code))
        .map((p) => ({ project: refOf(p), currentStageId: p.currentStageId, health: healthOf.get(p.id) ?? 'on_track', stages: stagesOf(state, p.id), deadlines: deadlinesOf(state, p.id) })),
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
    const query = normalizeForSearch(input.text);
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
        .filter((u) => u.active && hit(u.name, u.discipline))
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
