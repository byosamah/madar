import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Day, ProjectId, StageId, TaskId, UserId, type TimeEntry } from '../contract/entities';
import { forbidden, invalid } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { can } from '../permissions';
import { nextId, type State } from '../store';
import { addDays, dayOfWeek, diffDays, weekStartOf } from '../../lib/dates';
import { assertCan, requireProject, requireStage, requireUser, roleIn } from './shared';

const WeekStart = Day.refine((day) => dayOfWeek(day) === 0, 'A week starts on a Sunday.');
const Hours = z.number().min(0).max(24).multipleOf(0.5);

export function rowKeyOf(projectId: string, stageId: string, taskId: string | null): string {
  return `${projectId}|${stageId}|${taskId ?? '-'}`;
}

function pinKey(userId: string, weekStart: string, rowKey: string): string {
  return `${userId}|${weekStart}|${rowKey}`;
}

/** A week locks 14 days after its last day (Saturday), unless the Admin unlocked it. */
export function isWeekLocked(state: State, userId: string, weekStart: string, today: string): boolean {
  const unlocked = state.weekUnlocks.some((u) => u.userId === userId && u.weekStart === weekStart);
  return !unlocked && diffDays(addDays(weekStart, 6), today) >= 14;
}

const Row = z.object({
  key: z.string(),
  project: z.object({ id: ProjectId, code: z.string(), name: z.string() }),
  stage: z.object({ id: StageId, name: z.string() }),
  task: z.object({ id: TaskId, title: z.string() }).nullable(),
  hours: z.array(z.number()).length(7),
  total: z.number(),
  pinned: z.boolean(),
});
type RowView = z.infer<typeof Row>;

export const WeekView = z.object({
  userId: UserId,
  weekStart: Day,
  days: z.array(Day).length(7),
  locked: z.boolean(),
  unlocked: z.boolean(),
  target: z.number(),
  rows: z.array(Row),
  dayTotals: z.array(z.number()).length(7),
  weekTotal: z.number(),
});
export type WeekView = z.infer<typeof WeekView>;

export function weekViewOf(state: State, userId: string, weekStart: string, today: string): WeekView {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const rows = new Map<string, RowView>();
  const ensure = (projectId: string, stageId: string, taskId: string | null, pinned: boolean): RowView => {
    const key = rowKeyOf(projectId, stageId, taskId);
    let row = rows.get(key);
    if (!row) {
      const project = state.projects[projectId];
      const stage = state.stages[stageId];
      const task = taskId ? state.tasks[taskId] : undefined;
      row = {
        key,
        project: { id: projectId, code: project?.code ?? '', name: project?.name ?? '' },
        stage: { id: stageId, name: stage?.name ?? '' },
        task: task ? { id: task.id, title: task.title } : null,
        hours: [0, 0, 0, 0, 0, 0, 0],
        total: 0,
        pinned: false,
      };
      rows.set(key, row);
    }
    if (pinned) row.pinned = true;
    return row;
  };
  for (const pin of Object.values(state.timeRows)) {
    if (pin.userId === userId && pin.weekStart === weekStart) ensure(pin.projectId, pin.stageId, pin.taskId, true);
  }
  for (const entry of Object.values(state.time)) {
    if (entry.userId !== userId || entry.date < days[0] || entry.date > days[6]) continue;
    const row = ensure(entry.projectId, entry.stageId, entry.taskId, false);
    row.hours[diffDays(weekStart, entry.date)] += entry.hours;
    row.total += entry.hours;
  }
  const list = [...rows.values()].sort((a, b) =>
    a.project.code.localeCompare(b.project.code) || a.stage.name.localeCompare(b.stage.name) || a.key.localeCompare(b.key));
  const dayTotals = days.map((_, i) => list.reduce((sum, row) => sum + row.hours[i], 0));
  return {
    userId, weekStart, days,
    locked: isWeekLocked(state, userId, weekStart, today),
    unlocked: state.weekUnlocks.some((u) => u.userId === userId && u.weekStart === weekStart),
    target: state.users[userId]?.weeklyHourTarget ?? 0,
    rows: list,
    dayTotals,
    weekTotal: dayTotals.reduce((sum, hours) => sum + hours, 0),
  };
}

function assertLoggable(ctx: Ctx, projectId: string, stageId: string, taskId: string | null): void {
  const project = requireProject(ctx, projectId);
  assertCan(ctx, 'time.logOnProject', { projectRole: roleIn(ctx, project.id) });
  requireStage(ctx, project.id, stageId);
  if (taskId) {
    const task = ctx.state.tasks[taskId];
    if (!task || task.projectId !== project.id || task.stageId !== stageId) throw invalid('taskId', 'This task is not in that project stage.');
  }
}

function assertUnlocked(ctx: Ctx, weekStart: string): void {
  if (isWeekLocked(ctx.state, ctx.authority.id, weekStart, ctx.today)) throw forbidden('This week is locked.', { reason: 'week_locked' });
}

export const timeWeek = defineCall({
  input: z.object({ userId: UserId.optional(), weekStart: WeekStart }),
  output: WeekView,
  readOnly: true,
  run(input, ctx) {
    const userId = input.userId ?? ctx.authority.id;
    requireUser(ctx, userId);
    if (userId !== ctx.authority.id) assertCan(ctx, 'time.viewPerson', { targetUserId: userId });
    return weekViewOf(ctx.state, userId, input.weekStart, ctx.today);
  },
});

export const timeSet = defineCall({
  input: z.object({ projectId: ProjectId, stageId: StageId, taskId: TaskId.nullable().default(null), date: Day, hours: Hours }),
  output: WeekView,
  run(input, ctx) {
    const { state, today } = ctx;
    const actor = ctx.authority; // Hours always belong to a person, also when an agent logs them.
    assertLoggable(ctx, input.projectId, input.stageId, input.taskId);
    if (input.date > today) throw invalid('date', 'You cannot log hours for a future day.');
    const weekStart = weekStartOf(input.date);
    assertUnlocked(ctx, weekStart);
    const key = rowKeyOf(input.projectId, input.stageId, input.taskId);
    const sameDay = Object.values(state.time).filter((e) => e.userId === actor.id && e.date === input.date);
    const existing = sameDay.find((e) => rowKeyOf(e.projectId, e.stageId, e.taskId) === key);
    const others = sameDay.filter((e) => e !== existing).reduce((sum, e) => sum + e.hours, 0);
    if (others + input.hours > 24) throw invalid('hours', 'A day cannot have more than 24 hours.');
    const meta = { projectId: input.projectId, targetType: 'time' as const };
    if (input.hours === 0) {
      if (existing) {
        recordDelete(ctx, { ...meta, verb: 'time.cleared', targetId: existing.id, entity: existing });
        delete state.time[existing.id];
      }
    } else if (existing) {
      applyPatch(ctx, existing, { hours: input.hours }, { ...meta, verb: 'time.changed', targetId: existing.id });
    } else {
      const id = nextId(state, 'tim');
      const entry: TimeEntry = {
        id, userId: actor.id, projectId: input.projectId, stageId: input.stageId, taskId: input.taskId, date: input.date, hours: input.hours,
      };
      state.time[id] = entry;
      recordCreate(ctx, { ...meta, verb: 'time.logged', targetId: id, entity: entry });
    }
    return weekViewOf(state, actor.id, weekStart, today);
  },
});

export const timeAddRow = defineCall({
  input: z.object({ weekStart: WeekStart, projectId: ProjectId, stageId: StageId, taskId: TaskId.nullable().default(null) }),
  output: WeekView,
  run(input, ctx) {
    assertLoggable(ctx, input.projectId, input.stageId, input.taskId);
    assertUnlocked(ctx, input.weekStart);
    const key = pinKey(ctx.authority.id, input.weekStart, rowKeyOf(input.projectId, input.stageId, input.taskId));
    ctx.state.timeRows[key] = {
      key, userId: ctx.authority.id, weekStart: input.weekStart, projectId: input.projectId, stageId: input.stageId, taskId: input.taskId,
    };
    return weekViewOf(ctx.state, ctx.authority.id, input.weekStart, ctx.today);
  },
});

export const timeRemoveRow = defineCall({
  input: z.object({ weekStart: WeekStart, rowKey: z.string().min(1) }),
  output: WeekView,
  run(input, ctx) {
    const row = weekViewOf(ctx.state, ctx.authority.id, input.weekStart, ctx.today).rows.find((r) => r.key === input.rowKey);
    if (row && row.total > 0) throw invalid('rowKey', 'Clear the hours in this row first.');
    delete ctx.state.timeRows[pinKey(ctx.authority.id, input.weekStart, input.rowKey)];
    return weekViewOf(ctx.state, ctx.authority.id, input.weekStart, ctx.today);
  },
});

export const timeCopyLastWeek = defineCall({
  input: z.object({ weekStart: WeekStart }),
  output: WeekView,
  run(input, ctx) {
    assertUnlocked(ctx, input.weekStart);
    const previous = weekViewOf(ctx.state, ctx.authority.id, addDays(input.weekStart, -7), ctx.today);
    for (const row of previous.rows) {
      const project = ctx.state.projects[row.project.id];
      const stage = ctx.state.stages[row.stage.id];
      if (!project || project.status !== 'active' || !stage) continue;
      if (!can(ctx.authority, 'time.logOnProject', { projectRole: roleIn(ctx, project.id) })) continue;
      const taskId = row.task?.id ?? null;
      const key = pinKey(ctx.authority.id, input.weekStart, rowKeyOf(project.id, stage.id, taskId));
      ctx.state.timeRows[key] = { key, userId: ctx.authority.id, weekStart: input.weekStart, projectId: project.id, stageId: stage.id, taskId };
    }
    return weekViewOf(ctx.state, ctx.authority.id, input.weekStart, ctx.today);
  },
});

export const timeUnlockWeek = defineCall({
  input: z.object({ userId: UserId, weekStart: WeekStart }),
  output: WeekView,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    requireUser(ctx, input.userId);
    const known = ctx.state.weekUnlocks.some((u) => u.userId === input.userId && u.weekStart === input.weekStart);
    if (!known) ctx.state.weekUnlocks.push({ userId: input.userId, weekStart: input.weekStart });
    return weekViewOf(ctx.state, input.userId, input.weekStart, ctx.today);
  },
});

export const timeCalls = {
  'time.week': timeWeek,
  'time.set': timeSet,
  'time.addRow': timeAddRow,
  'time.removeRow': timeRemoveRow,
  'time.copyLastWeek': timeCopyLastWeek,
  'time.unlockWeek': timeUnlockWeek,
};
