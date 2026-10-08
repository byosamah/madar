import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { DurationDays, Gender, StageName, TaskId, TaskSchedule, TaskTemplate, TaskTemplateId } from '../contract/entities';
import { sameText } from '../../lib/sameText';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { nextId, taskTemplatesOf } from '../store';
import { namesUnder } from '../views';
import { assertCan, requireTask, roleIn } from './shared';

const Title = z.string().trim().min(1).max(200);
const ItemTitle = z.string().trim().min(1).max(200);

/**
 * A template as a screen reads it: the name of the person who saved it, and whether the current person may rename or delete it.
 * The gender of that person picks the Arabic verb of "saved by" (audit 2026-10-03, SHL-17).
 */
export const TaskTemplateRow = TaskTemplate.extend({
  createdByName: z.string(), createdByNameAr: z.string().optional(), createdByGender: Gender.optional(), canEdit: z.boolean(),
});
export type TaskTemplateRow = z.infer<typeof TaskTemplateRow>;

function mayEdit(ctx: Ctx, template: TaskTemplate): boolean {
  return ctx.authority.active && (ctx.authority.systemRole === 'admin' || template.createdBy === ctx.authority.id);
}

const rowOf = (ctx: Ctx, template: TaskTemplate) => ({
  ...template, ...namesUnder('createdByName', ctx.state.users[template.createdBy]), createdByGender: ctx.state.users[template.createdBy]?.gender, canEdit: mayEdit(ctx, template),
});

function assertNameFree(ctx: Ctx, name: string, stageName: string, exceptId: string | null): void {
  const taken = Object.values(taskTemplatesOf(ctx.state)).some((t) => t.id !== exceptId && sameText(t.name, name) && sameText(t.stageName, stageName));
  if (taken) throw invalid('name', 'A template with this name exists for this stage. Use another name.', 'duplicate_name');
}

/** Anyone who leads a project, and the Admin, saves templates from the project's tasks or by hand. */
function assertMayLeadSomething(ctx: Ctx): void {
  const leads = ctx.authority.systemRole === 'admin' || Object.values(ctx.state.projects).some((p) => p.leaderId === ctx.authority.id);
  if (!ctx.authority.active || !leads) throw forbidden('Only a project leader or the Admin can save a task template.');
}

const taskTemplatesList = defineCall({
  input: z.object({ stageName: StageName.optional() }),
  output: z.array(TaskTemplateRow),
  readOnly: true,
  run(input, ctx) {
    return Object.values(taskTemplatesOf(ctx.state))
      .filter((t) => !input.stageName || sameText(t.stageName, input.stageName))
      .sort((a, b) => a.stageName.localeCompare(b.stageName) || a.name.localeCompare(b.name))
      .map((t) => rowOf(ctx, t));
  },
});

/** Saves a template from a task ("fromTaskId"; the other fields then override it) or from fields alone (name and stageName). */
const taskTemplatesSave = defineCall({
  input: z.object({
    fromTaskId: TaskId.optional(),
    name: Title.optional(),
    stageName: StageName.optional(),
    description: z.string().max(5000).optional(),
    checklist: z.array(ItemTitle).max(100).optional(),
    needsReview: z.boolean().optional(),
    schedule: TaskSchedule.optional(),
    durationDays: DurationDays.nullable().optional(),
  }),
  output: TaskTemplateRow,
  run(input, ctx) {
    let base: Partial<TaskTemplate> = {};
    if (input.fromTaskId) {
      const task = requireTask(ctx, input.fromTaskId);
      // A template belongs to a stage, so an office task never becomes one (owner, 2026-10-06).
      if (task.stageId === null) throw invalid('fromTaskId', 'An office task belongs to no project, so it has no stage.', 'office_no_stage');
      assertCan(ctx, 'task.updateAny', { projectRole: roleIn(ctx, task.projectId) });
      base = {
        name: task.title, stageName: ctx.state.stages[task.stageId]?.name, description: task.description, checklist: task.checklist.map((item) => item.text),
        needsReview: task.needsReview, schedule: task.schedule ?? 'static', durationDays: task.durationDays ?? null,
      };
    } else assertMayLeadSomething(ctx);
    const name = input.name ?? base.name;
    const stageName = input.stageName ?? base.stageName;
    if (!name) throw invalid('name', 'A template needs a name.');
    if (!stageName) throw invalid('stageName', 'A template needs a stage.');
    const schedule = input.schedule ?? base.schedule ?? 'static';
    const durationDays = schedule === 'dynamic' ? (input.durationDays !== undefined ? input.durationDays : base.durationDays ?? null) : null;
    if (schedule === 'dynamic' && !durationDays) throw invalid('durationDays', 'A dynamic template needs a duration in working days.', 'dynamic_needs_duration');
    assertNameFree(ctx, name, stageName, null);
    const id = nextId(ctx.state, 'ttp');
    const template: TaskTemplate = {
      id, name, stageName, description: input.description ?? base.description ?? '', checklist: input.checklist ?? base.checklist ?? [],
      needsReview: input.needsReview ?? base.needsReview ?? true, schedule, durationDays, createdBy: ctx.authority.id, createdAt: ctx.stamp,
    };
    taskTemplatesOf(ctx.state)[id] = template;
    recordCreate(ctx, { projectId: null, verb: 'taskTemplate.created', targetType: 'taskTemplate', targetId: id, entity: template });
    return rowOf(ctx, template);
  },
});

function requireTemplate(ctx: Ctx, id: string): TaskTemplate {
  const template = taskTemplatesOf(ctx.state)[id];
  if (!template) throw notFound('Task template', id);
  return template;
}

const taskTemplatesRename = defineCall({
  input: z.object({ id: TaskTemplateId, name: Title }),
  output: TaskTemplateRow,
  run(input, ctx) {
    const template = requireTemplate(ctx, input.id);
    if (!mayEdit(ctx, template)) throw forbidden('Only the person who saved this template or the Admin can rename it.');
    assertNameFree(ctx, input.name, template.stageName, template.id);
    applyPatch(ctx, template, { name: input.name }, { projectId: null, verb: 'taskTemplate.renamed', targetType: 'taskTemplate', targetId: template.id });
    return rowOf(ctx, template);
  },
});

const taskTemplatesDelete = defineCall({
  input: z.object({ id: TaskTemplateId }),
  output: z.object({ ok: z.literal(true) }),
  run(input, ctx) {
    const template = requireTemplate(ctx, input.id);
    if (!mayEdit(ctx, template)) throw forbidden('Only the person who saved this template or the Admin can delete it.');
    delete taskTemplatesOf(ctx.state)[template.id];
    recordDelete(ctx, { projectId: null, verb: 'taskTemplate.deleted', targetType: 'taskTemplate', targetId: template.id, entity: template });
    return { ok: true as const };
  },
});

export const taskTemplateCalls = {
  'taskTemplates.list': taskTemplatesList,
  'taskTemplates.save': taskTemplatesSave,
  'taskTemplates.rename': taskTemplatesRename,
  'taskTemplates.delete': taskTemplatesDelete,
};
