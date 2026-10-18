import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import {
  Gender, ProjectTemplate, ProjectTemplateId, TEMPLATE_MAX_ROLES, TEMPLATE_MAX_STAGES, TEMPLATE_MAX_TASKS, TemplateRole, TemplateStage, TemplateTask,
} from '../contract/entities';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { hasCycle } from '../flow';
import { nextId, projectTemplatesOf } from '../store';
import { namesUnder } from '../views';
import { assertCan } from './shared';

const TemplateName = z.string().trim().min(1).max(60);

/**
 * A template as a screen reads it: the name and gender of the person who saved it (the Arabic verb of "saved by"), and whether
 * the current person may change or delete it.
 */
export const ProjectTemplateRow = ProjectTemplate.extend({
  createdByName: z.string(), createdByNameAr: z.string().optional(), createdByGender: Gender.optional(), canEdit: z.boolean(),
});
export type ProjectTemplateRow = z.infer<typeof ProjectTemplateRow>;

/** The person who saved a template, or the Admin, changes and deletes it (as stage templates, 2026-10-01). */
function mayChange(ctx: Ctx, template: ProjectTemplate): boolean {
  return ctx.authority.active && (ctx.authority.systemRole === 'admin' || template.createdBy === ctx.authority.id);
}

function rowOf(ctx: Ctx, template: ProjectTemplate): ProjectTemplateRow {
  const author = ctx.state.users[template.createdBy];
  return { ...structuredClone(template), ...namesUnder('createdByName', author), createdByGender: author?.gender, canEdit: mayChange(ctx, template) };
}

const Parts = z.object({
  name: TemplateName,
  roles: z.array(TemplateRole).max(TEMPLATE_MAX_ROLES),
  stages: z.array(TemplateStage).min(1).max(TEMPLATE_MAX_STAGES),
  tasks: z.array(TemplateTask).max(TEMPLATE_MAX_TASKS),
});
type Parts = z.output<typeof Parts>;

/** The rules that one field cannot hold alone. The checks run before any change, so a refused template changes nothing. */
function assertParts(ctx: Ctx, parts: Parts, selfId: string | null): void {
  const key = parts.name.toLowerCase();
  if (Object.values(projectTemplatesOf(ctx.state)).some((t) => t.id !== selfId && t.name.toLowerCase() === key)) {
    throw invalid('name', 'A template with this name exists. Use another name.', 'duplicate_name');
  }
  // fixedTaskIds of projects.create names tasks and stages with one list, so an id is unique in the whole template.
  const ids = new Set<string>();
  for (const [field, list] of [['roles', parts.roles], ['stages', parts.stages], ['tasks', parts.tasks]] as const) {
    for (const part of list) {
      if (ids.has(part.id)) throw invalid(field, `The id "${part.id}" is in the template twice.`);
      ids.add(part.id);
    }
  }
  const roleNames = new Set<string>();
  for (const role of parts.roles) {
    const lower = role.name.toLowerCase();
    if (roleNames.has(lower)) throw invalid('roles', `The role "${role.name}" is in the list twice.`);
    roleNames.add(lower);
    if (role.defaultUserId === null) continue;
    const person = ctx.state.users[role.defaultUserId];
    if (!person || person.kind !== 'human') throw invalid('roles', 'The default person of a role must be a person of the office. Agents act for a person.');
    if (!person.active) throw invalid('roles', 'This person is no longer active. Pick someone else.', 'person_inactive');
  }
  const stageNames = new Set<string>();
  for (const stage of parts.stages) {
    const lower = stage.name.toLowerCase();
    if (stageNames.has(lower)) throw invalid('stages', `The stage "${stage.name}" is in the list twice.`, 'duplicate_stage');
    stageNames.add(lower);
    if ((stage.startOffset === null) !== (stage.durationDays === null)) {
      throw invalid('stages', `The stage "${stage.name}" needs both a start day and a length, or neither.`);
    }
  }
  const stageIds = new Set(parts.stages.map((stage) => stage.id));
  const roleIds = new Set(parts.roles.map((role) => role.id));
  for (const task of parts.tasks) {
    if (!stageIds.has(task.stageId)) throw invalid('tasks', `The task "${task.title}" names a stage that is not in the template.`);
    if (task.roleId !== null && !roleIds.has(task.roleId)) throw invalid('tasks', `The task "${task.title}" names a role that is not in the template.`);
  }
  assertWaits('stages', parts.stages);
  assertWaits('tasks', parts.tasks);
}

/**
 * The waits of the stages, or of the tasks, of one template. A wait names a part of the same list, once. No chain of waits may
 * loop back to its part, and a part that waits for itself is refused too.
 */
function assertWaits(field: 'stages' | 'tasks', parts: { id: string; prerequisiteIds?: string[] }[]): void {
  const ids = new Set(parts.map((part) => part.id));
  const edges = new Map<string, string[]>();
  for (const part of parts) {
    const waits = part.prerequisiteIds ?? [];
    if (new Set(waits).size !== waits.length) throw invalid(field, 'A part is in its list of waits twice.', 'duplicate_prerequisite');
    for (const id of waits) {
      if (!ids.has(id)) throw invalid(field, `The part "${id}" that it waits for is not in the template.`, 'prerequisite_not_in_template');
    }
    edges.set(part.id, waits);
  }
  if (hasCycle(edges)) throw invalid(field, 'These parts would wait for each other.', 'dependency_cycle');
}

/** The number in a part id: s12 gives 12. An id with no number gives 0. */
const numberOf = (partId: string): number => {
  const match = /^[a-z](\d+)$/.exec(partId);
  return match ? Number(match[1]) : 0;
};

/**
 * The highest part number that a template has given (fbk_008 item 4): its stored number, and the numbers in its ids before the
 * save and in the saved ids. A removed part keeps its number, so a new part never gets its id. A template saved before partSeq
 * existed takes its number from its ids.
 */
function partSeqOf(existing: ProjectTemplate | null, parts: Parts): number {
  const saved = [...parts.roles, ...parts.stages, ...parts.tasks].map((part) => part.id);
  const before = existing ? [...existing.roles, ...existing.stages, ...existing.tasks].map((part) => part.id) : [];
  return Math.max(existing?.partSeq ?? 0, ...[...saved, ...before].map(numberOf));
}

const projectTemplatesList = defineCall({
  input: z.object({}),
  output: z.array(ProjectTemplateRow),
  readOnly: true,
  run(_input, ctx) {
    return Object.values(projectTemplatesOf(ctx.state))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((template) => rowOf(ctx, template));
  },
});

/** Saves a new template, or with "id" changes one. Anyone who may create a project may save one (as stage templates). */
const projectTemplatesSave = defineCall({
  input: Parts.extend({ id: ProjectTemplateId.optional() }),
  output: ProjectTemplateRow,
  run(input, ctx) {
    assertCan(ctx, 'project.create');
    const templates = projectTemplatesOf(ctx.state);
    const { id: givenId, ...parts } = input;
    if (givenId !== undefined) {
      const template = templates[givenId];
      if (!template) throw notFound('Project template', givenId);
      if (!mayChange(ctx, template)) throw forbidden('Only the person who saved this template or the Admin can change it.');
      assertParts(ctx, parts, template.id);
      const same = JSON.stringify(Parts.parse({ name: template.name, roles: template.roles, stages: template.stages, tasks: template.tasks })) === JSON.stringify(parts);
      if (!same) {
        applyPatch(ctx, template, { ...parts, partSeq: partSeqOf(template, parts), updatedAt: ctx.stamp }, { projectId: null, verb: 'projectTemplate.updated', targetType: 'projectTemplate', targetId: template.id });
      }
      return rowOf(ctx, template);
    }
    assertParts(ctx, parts, null);
    const id = nextId(ctx.state, 'ptp');
    const template: ProjectTemplate = { id, ...parts, partSeq: partSeqOf(null, parts), createdBy: ctx.authority.id, createdAt: ctx.stamp, updatedAt: ctx.stamp };
    templates[id] = template;
    recordCreate(ctx, { projectId: null, verb: 'projectTemplate.created', targetType: 'projectTemplate', targetId: id, entity: template });
    return rowOf(ctx, template);
  },
});

const projectTemplatesDelete = defineCall({
  input: z.object({ id: ProjectTemplateId }),
  output: z.object({ ok: z.literal(true) }),
  run(input, ctx) {
    const templates = projectTemplatesOf(ctx.state);
    const template = templates[input.id];
    if (!template) throw notFound('Project template', input.id);
    if (!mayChange(ctx, template)) throw forbidden('Only the person who saved this template or the Admin can delete it.');
    delete templates[input.id];
    recordDelete(ctx, { projectId: null, verb: 'projectTemplate.deleted', targetType: 'projectTemplate', targetId: input.id, entity: template });
    return { ok: true as const };
  },
});

export const projectTemplateCalls = {
  'projectTemplates.list': projectTemplatesList,
  'projectTemplates.save': projectTemplatesSave,
  'projectTemplates.delete': projectTemplatesDelete,
};
