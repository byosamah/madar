import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import {
  Gender, Project, ProjectId, ProjectStatus, ProjectTemplate, ProjectTemplateId, Stage, StageId, Task, TaskId, TEMPLATE_MAX_ROLES,
  TEMPLATE_MAX_STAGES, TEMPLATE_MAX_TASKS, TemplatePartId, TemplateRole, TemplateStage, TemplateTask, UserId,
} from '../contract/entities';
import { ProjectRef } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { hasCycle, watchStage } from '../flow';
import { notifyIn } from '../notify';
import { staleDaysOf } from '../pause';
import { projectViewer } from '../projectView';
import { can } from '../permissions';
import { nextId, projectTemplatesOf } from '../store';
import { markOf } from '../../lib/projectMark';
import { shiftAdded } from '../../lib/projectPlan';
import { matchByNames } from '../../lib/templateMatch';
import { workingDaysInclusive } from '../../lib/templatePlan';
import { baseOf, nextBase, planOf, syncDiff, textChanges, type ItemRef, type SyncChoices, type SyncDiff } from '../templateSync';
import { namesUnder, stagesOf } from '../views';
import { assertCan, byName, ensureOnTeam, insertComment, requireProject, roleIn, seesProject, touch } from './shared';
import { dateMoveOf } from './tasks';

const TemplateName = z.string().trim().min(1).max(60);

/**
 * A template as a screen reads it: the name and gender of the person who saved it (the Arabic verb of "saved by"), and whether
 * the current person may change or delete it.
 */
export const ProjectTemplateRow = ProjectTemplate.extend({
  createdByName: z.string(), createdByNameAr: z.string().optional(), createdByGender: Gender.optional(), canEdit: z.boolean(),
  /** The open projects that follow the template (ADM-05). Only a person who sends the update (templates.updateProjects) gets the number. */
  followers: z.number().int().nonnegative().optional(),
});
export type ProjectTemplateRow = z.infer<typeof ProjectTemplateRow>;

/**
 * The person who saved a template changes and deletes it (owner, 2026-10-18). A person with the switch "change any project template"
 * (templates.projectAny) changes and deletes the templates of others (role rights version 2).
 */
function mayChange(ctx: Ctx, template: ProjectTemplate): boolean {
  return ctx.authority.active && (can(ctx.authority, 'templates.projectAny') || template.createdBy === ctx.authority.id);
}

function rowOf(ctx: Ctx, template: ProjectTemplate): ProjectTemplateRow {
  const author = ctx.state.users[template.createdBy];
  // The number counts the open projects that the person sees (hidden projects, owner 2026-10-22).
  const sees = projectViewer(ctx.state, ctx.authority);
  const followers = can(ctx.authority, 'templates.updateProjects')
    ? Object.values(ctx.state.projects).filter((project) => sees(project) && project.templateLink?.templateId === template.id && (project.status === 'active' || project.status === 'on_hold')).length
    : undefined;
  return {
    ...structuredClone(template), ...namesUnder('createdByName', author), createdByGender: author?.gender, canEdit: mayChange(ctx, template),
    ...(followers !== undefined ? { followers } : {}),
  };
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
 * The highest part number that a template has given (fbk_008 item 4). It is the largest of the stored number, the numbers of
 * the ids before the save, and the numbers of the saved ids. A removed part keeps its number, so a new part never gets its id.
 * A template saved before partSeq existed takes its number from its ids.
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

/**
 * Saves a new template, or with "id" changes one. A new template needs the switch templates.projectCreate (off for a Member by default,
 * owner 2026-10-21). A change is the right of the saver, or of the switch templates.projectAny.
 */
const projectTemplatesSave = defineCall({
  input: Parts.extend({ id: ProjectTemplateId.optional() }),
  output: ProjectTemplateRow,
  run(input, ctx) {
    const templates = projectTemplatesOf(ctx.state);
    const { id: givenId, ...parts } = input;
    if (givenId === undefined) assertCan(ctx, 'templates.projectCreate');
    if (givenId !== undefined) {
      const template = templates[givenId];
      if (!template) throw notFound('Project template', givenId);
      if (!mayChange(ctx, template)) throw forbidden('Only the person who saved this template, or a person with the template right, can change it.');
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
    if (!mayChange(ctx, template)) throw forbidden('Only the person who saved this template, or a person with the template right, can delete it.');
    delete templates[input.id];
    recordDelete(ctx, { projectId: null, verb: 'projectTemplate.deleted', targetType: 'projectTemplate', targetId: input.id, entity: template });
    return { ok: true as const };
  },
});

const MatchPlanOutput = z.object({
  stages: z.record(TemplatePartId, StageId.nullable()),
  tasks: z.record(TemplatePartId, TaskId.nullable()),
});

/** The stages and tasks of one project, as the name matching reads them. */
function itemsOf(ctx: Ctx, projectId: string) {
  return {
    stages: Object.values(ctx.state.stages).filter((stage) => stage.projectId === projectId),
    tasks: Object.values(ctx.state.tasks).filter((task) => task.projectId === projectId),
  };
}

/** The matches that a link takes: each part of the template at most once, and each item of this project at most once. */
function assertMatches(field: 'stageMatches' | 'taskMatches', matches: Record<string, string | null>, partIds: string[], itemIds: string[]): void {
  const parts = new Set(partIds);
  const items = new Set(itemIds);
  const used = new Set<string>();
  for (const [partId, itemId] of Object.entries(matches)) {
    if (!parts.has(partId)) throw invalid(field, `The part "${partId}" is not in the template.`, 'part_not_in_template');
    if (itemId === null) continue;
    if (!items.has(itemId)) throw invalid(field, `The item "${itemId}" is not in this project.`, 'item_not_in_project');
    if (used.has(itemId)) throw invalid(field, `The item "${itemId}" matches two parts.`, 'duplicate_match');
    used.add(itemId);
  }
}

/**
 * The apply of a template to one ongoing project (owner, 2026-10-19, fbk_020) is a project matter: the leader of the project and the
 * Admin may do it (project.template), on an open project (active or paused). A done or archived project is refused. The update of many
 * projects and the template edits stay with the Admin and the template right (ADM-03).
 */
function assertMayApply(ctx: Ctx, project: Project): void {
  assertCan(ctx, 'project.template', { projectRole: roleIn(ctx, project.id) });
  if (project.status !== 'active' && project.status !== 'on_hold') {
    throw invalid('projectId', 'This project is closed. A template goes only to an open project.', 'project_closed');
  }
}

/**
 * The project items that match each part of a template, by name (fbk_008 item 4). The link sheet fills its picks with this read.
 * The leader of the project and the Admin read it (assertMayApply).
 */
const projectTemplatesMatchPlan = defineCall({
  input: z.object({ projectId: ProjectId, templateId: ProjectTemplateId }),
  output: MatchPlanOutput,
  readOnly: true,
  run(input, ctx) {
    // The view check comes first: a hidden project reads as missing (hidden projects, owner 2026-10-22).
    const project = requireProject(ctx, input.projectId);
    assertMayApply(ctx, project);
    const template = projectTemplatesOf(ctx.state)[input.templateId];
    if (!template) throw notFound('Project template', input.templateId);
    const { stages, tasks } = itemsOf(ctx, input.projectId);
    return matchByNames(template, stages, tasks);
  },
});

/**
 * Takes the part id off a stage or a task, as one event. The event keeps the old id, so an Undo of the story puts it back. As in
 * applyPatch, the event names the field on both sides (after is undefined), so the stored event reads the same way (pairEventFields).
 */
function forgetPartId(ctx: Ctx, item: Stage | Task, targetType: 'stage' | 'task'): void {
  if (item.templatePartId === undefined) return;
  const before = { templatePartId: item.templatePartId };
  delete item.templatePartId;
  writeEvent(ctx, { projectId: item.projectId, verb: `${targetType}.template_linked`, targetType, targetId: item.id, before, after: { templatePartId: undefined } });
}

/**
 * Links an older project to a template (fbk_008 item 4). The picks say which item of the project matches each part. A template part
 * with no pick is dropped from the project. One story holds the link and every part id, so one Undo takes all of it back.
 * A project holds one link. A project that follows a template takes another one only with "replace": the part ids of the old template
 * leave its stages and tasks first, so they never look like parts of the new template (owner, 2026-10-19, fbk_020).
 * The leader of the project and the Admin may link (assertMayApply).
 */
const projectTemplatesLink = defineCall({
  input: z.object({
    projectId: ProjectId,
    templateId: ProjectTemplateId,
    stageMatches: z.record(TemplatePartId, StageId.nullable()),
    taskMatches: z.record(TemplatePartId, TaskId.nullable()),
    rolePeople: z.record(TemplatePartId, UserId.nullable()),
    replace: z.boolean().optional(),
  }),
  output: z.object({}),
  run(input, ctx) {
    // The view check comes first: a hidden project reads as missing (hidden projects, owner 2026-10-22).
    const project = requireProject(ctx, input.projectId);
    assertMayApply(ctx, project);
    const template = projectTemplatesOf(ctx.state)[input.templateId];
    if (!template) throw notFound('Project template', input.templateId);
    if (project.templateLink && (input.replace !== true || project.templateLink.templateId === template.id)) {
      throw invalid('projectId', 'This project is already linked to a template.', 'already_linked');
    }
    const { stages, tasks } = itemsOf(ctx, input.projectId);
    assertMatches('stageMatches', input.stageMatches, template.stages.map((part) => part.id), stages.map((stage) => stage.id));
    assertMatches('taskMatches', input.taskMatches, template.tasks.map((part) => part.id), tasks.map((task) => task.id));
    const roleIds = new Set(template.roles.map((role) => role.id));
    for (const [roleId, userId] of Object.entries(input.rolePeople)) {
      if (!roleIds.has(roleId)) throw invalid('rolePeople', `The role "${roleId}" is not in the template.`, 'part_not_in_template');
      if (userId === null) continue;
      const person = ctx.state.users[userId];
      if (!person || person.kind !== 'human') throw invalid('rolePeople', 'The person of a role must be a person of the office. Agents act for a person.');
      if (!person.active) throw invalid('rolePeople', 'This person is no longer active. Pick someone else.', 'person_inactive');
    }
    const stageParts = template.stages.map((part) => ({ partId: part.id, itemId: input.stageMatches[part.id] ?? null }));
    const taskParts = template.tasks.map((part) => ({ partId: part.id, itemId: input.taskMatches[part.id] ?? null }));
    const dropped = [...stageParts, ...taskParts].filter((part) => part.itemId === null).map((part) => part.partId);
    const rolePeople = Object.fromEntries(template.roles.map((role) => [role.id, input.rolePeople[role.id] ?? null]));
    const meta = { projectId: project.id };
    if (project.templateLink) {
      for (const stage of stages) forgetPartId(ctx, stage, 'stage');
      for (const task of tasks) forgetPartId(ctx, task, 'task');
    }
    applyPatch(ctx, project, {
      templateLink: { templateId: template.id, linkedAt: ctx.stamp, syncedAt: null, rolePeople, droppedPartIds: dropped, base: baseOf(template, planOf(template, project)) },
    }, { ...meta, verb: 'project.template_linked', targetType: 'project', targetId: project.id });
    for (const part of stageParts) {
      if (part.itemId === null) continue;
      const stage = ctx.state.stages[part.itemId];
      applyPatch(ctx, stage, { templatePartId: part.partId }, { ...meta, verb: 'stage.template_linked', targetType: 'stage', targetId: stage.id });
    }
    for (const part of taskParts) {
      if (part.itemId === null) continue;
      const task = ctx.state.tasks[part.itemId];
      applyPatch(ctx, task, { templatePartId: part.partId }, { ...meta, verb: 'task.template_linked', targetType: 'task', targetId: task.id });
    }
    return {};
  },
});

const DateReason = z.string().trim().min(1).max(280);

/** The Admin's picks of one update. Each pick matches a field of SyncChoices (templateSync.ts). */
const SyncChoicesInput = z.object({
  add: z.boolean(),
  bringBack: z.boolean(),
  removed: z.enum(['keep', 'delete_unstarted']),
  text: z.boolean(),
  dates: z.boolean(),
  leads: z.boolean(),
  closed: z.enum(['leave', 'text_only']),
  stages: z.boolean(),
  /** The tasks and stages that the team edited and the template changed too. keep: the team's version stays (ADM-01). */
  edited: z.enum(['keep', 'use_template']).default('keep'),
});

/**
 * The picks of the apply of a template to an ongoing project: only the parts that the project leaves out come in. A person with the
 * project right sends exactly these picks; any other pick is the update of linked projects, which stays with the Admin.
 */
const isApplyChoices = (choices: SyncChoices): boolean =>
  choices.bringBack && !choices.add && choices.removed === 'keep' && !choices.text && !choices.dates && !choices.leads
  && choices.closed === 'leave' && !choices.stages && choices.edited === 'keep';

const PartRefOut = z.object({ partId: TemplatePartId, title: z.string(), stagePartId: TemplatePartId.nullable() });
const SpanOut = z.object({ start: z.string().nullable(), due: z.string().nullable() });
const ItemRefOut = z.object({
  itemId: z.string(), partId: TemplatePartId, title: z.string(),
  newTitle: z.string().optional(), description: z.boolean().optional(),
  dates: z.object({ from: SpanOut, to: SpanOut }).optional(),
  lead: z.object({ from: UserId.nullable(), to: UserId.nullable() }).optional(),
  stage: z.boolean().optional(),
});
const SyncDiffOut = z.object({
  add: z.array(PartRefOut), dropped: z.array(PartRefOut), removed: z.array(ItemRefOut), text: z.array(ItemRefOut), dates: z.array(ItemRefOut),
  leads: z.array(ItemRefOut), closed: z.array(ItemRefOut), stages: z.array(ItemRefOut), edited: z.array(ItemRefOut), people: z.array(UserId),
});

const UsageRow = z.object({ project: ProjectRef, status: ProjectStatus, staleDays: z.number().int().nullable() });
export type UsageRow = z.infer<typeof UsageRow>;
const SyncCounts = z.object({
  added: z.number().int(), broughtBack: z.number().int(), removed: z.number().int(), text: z.number().int(), dates: z.number().int(),
  leads: z.number().int(), closed: z.number().int(), stages: z.number().int(), edited: z.number().int(),
});

const refOf = (project: Project) => ({ id: project.id, code: project.code, name: project.name, mark: markOf(project) });

function templateOf(ctx: Ctx, templateId: string): ProjectTemplate {
  const template = projectTemplatesOf(ctx.state)[templateId];
  if (!template) throw notFound('Project template', templateId);
  return template;
}

/** A person the template update may name: active, and a person (an agent acts for a person). */
const activePerson = (ctx: Ctx) => (userId: string): boolean => {
  const user = ctx.state.users[userId];
  return user !== undefined && user.kind === 'human' && user.active;
};

/** The date fields that the plan gives a task. A dynamic task also keeps its working days. */
function plannedChanges(task: Task, planned: { startDate: string; dueDate: string }): Partial<Task> {
  const changes: Partial<Task> = { startDate: planned.startDate, dueDate: planned.dueDate };
  if (task.schedule === 'dynamic') changes.durationDays = workingDaysInclusive(planned.startDate, planned.dueDate);
  return changes;
}

/**
 * The open projects of a template (fbk_008 item 4): the projects linked to it, and the open projects with no link yet. Open means
 * active or on hold. staleDays is the days a paused project has waited, when it is stale.
 */
const projectTemplatesUsage = defineCall({
  input: z.object({ templateId: ProjectTemplateId }),
  output: z.object({ linked: z.array(UsageRow), notLinked: z.array(UsageRow) }),
  readOnly: true,
  run(input, ctx) {
    assertCan(ctx, 'templates.updateProjects');
    const template = templateOf(ctx, input.templateId);
    const row = (project: Project) => ({ project: refOf(project), status: project.status, staleDays: staleDaysOf(ctx.state, project, ctx.today) });
    const sees = projectViewer(ctx.state, ctx.authority);
    const open = Object.values(ctx.state.projects).filter((project) => sees(project) && (project.status === 'active' || project.status === 'on_hold')).sort(byName);
    return {
      linked: open.filter((project) => project.templateLink?.templateId === template.id).map(row),
      notLinked: open.filter((project) => !project.templateLink).map(row),
    };
  },
});

/**
 * The diff of each listed project that is linked to the template (fbk_008 item 4). A project that does not exist, or is not linked to
 * this template, gets no row. Nothing changes: the Admin reads the diff before syncApply.
 */
const projectTemplatesSyncPlan = defineCall({
  input: z.object({ templateId: ProjectTemplateId, projectIds: z.array(ProjectId).min(1).max(50) }),
  output: z.array(z.object({ project: ProjectRef, diff: SyncDiffOut })),
  readOnly: true,
  run(input, ctx) {
    assertCan(ctx, 'templates.updateProjects');
    const template = templateOf(ctx, input.templateId);
    const rows: { project: ReturnType<typeof refOf>; diff: SyncDiff }[] = [];
    for (const projectId of new Set(input.projectIds)) {
      const project = ctx.state.projects[projectId];
      if (!project || !seesProject(ctx, projectId) || project.templateLink?.templateId !== template.id) continue;
      const { stages, tasks } = itemsOf(ctx, projectId);
      rows.push({ project: refOf(project), diff: syncDiff(template, project, stages, tasks, activePerson(ctx)) });
    }
    return rows;
  },
});

/**
 * The template update of one project (fbk_008 item 4). It makes only the picks that the Admin ticks, and it moves the project's link
 * to the update. A date move needs one reason (dateReason) before any change. The change of each project is in one story, so one Undo of
 * the story takes all of it back. A task that was dropped comes back only with bringBack. A closed task keeps its dates and lead.
 */
const projectTemplatesSyncApply = defineCall({
  input: z.object({
    templateId: ProjectTemplateId,
    projectId: ProjectId,
    choices: SyncChoicesInput,
    dateReason: DateReason.optional(),
    /**
     * The apply of a template to an ongoing project (owner, 2026-10-19, fbk_020), right after its link, in the same story. With the
     * picks of isApplyChoices the project right is enough (assertMayApply). The added parts then start today when the template dates
     * are past (shiftAdded), their leads get the new-task notice, and the History line says that the template was applied.
     */
    apply: z.boolean().optional(),
  }),
  output: SyncCounts,
  run(input, ctx) {
    const applying = input.apply === true && isApplyChoices(input.choices);
    if (!applying) assertCan(ctx, 'templates.updateProjects');
    const template = templateOf(ctx, input.templateId);
    const project = requireProject(ctx, input.projectId);
    if (applying) assertMayApply(ctx, project);
    const link = project.templateLink;
    if (!link) throw invalid('projectId', 'This project is not linked to a template.', 'not_linked');
    if (link.templateId !== template.id) throw invalid('templateId', 'This project is linked to another template.', 'other_template');
    const { choices } = input;
    const active = activePerson(ctx);
    const { stages, tasks } = itemsOf(ctx, project.id);
    const diff = syncDiff(template, project, stages, tasks, active);
    const plan = planOf(template, project);
    // The team's own edits stay unless the Admin picks the template for them (ADM-01).
    const useEdited = choices.edited === 'use_template';
    const editedTasks = useEdited ? diff.edited.filter((item) => !item.stage) : [];
    const dateItems = [...(choices.dates ? diff.dates : []), ...editedTasks.filter((item) => item.dates !== undefined)];
    // A date move asks one reason first, before any change (owner rule, 2026-10-01).
    const movesDates = dateItems.some((item) => {
      const task = ctx.state.tasks[item.itemId];
      const planned = plan?.tasks[item.partId];
      return planned !== undefined && dateMoveOf(task, plannedChanges(task, planned)) !== null;
    });
    if (movesDates && !input.dateReason) throw invalid('dateReason', 'Write why the dates change.', 'date_reason_needed');

    const watch = watchStage(ctx, project.id);
    const counts = { added: 0, broughtBack: 0, removed: 0, text: 0, dates: 0, leads: 0, closed: 0, stages: 0, edited: 0 };
    const restored = new Set<string>();
    // "No review" is the review need, which belongs to the reviewer (task.review), not to the right to change a task.
    const maySkipReview = can(ctx.authority, 'task.review', { projectRole: roleIn(ctx, project.id) });
    const stagePart = new Map(template.stages.map((part) => [part.id, part]));
    const taskPart = new Map(template.tasks.map((part) => [part.id, part]));
    const rolePart = new Map(template.roles.map((role) => [role.id, role]));
    const stageIdOf = (partId: string): string | undefined =>
      Object.values(ctx.state.stages).find((stage) => stage.projectId === project.id && stage.templatePartId === partId)?.id;
    // The lead of a role for a new task: the template's person when the lead pick is on, else the person the project has now.
    const leadOf = (roleId: string): string | null => {
      const role = rolePart.get(roleId);
      if (!role) return null;
      const person = choices.leads ? role.defaultUserId : link.rolePeople[roleId] ?? null;
      return person !== null && active(person) ? person : null;
    };

    // Stages: the new names, then the new stages and the dropped stages that come back. Each change is its own event, so an Undo
    // of the story takes the stages back after their tasks (the Undo runs newest first).
    if (choices.stages) {
      for (const item of diff.stages) {
        applyPatch(
          ctx, ctx.state.stages[item.itemId], { name: stagePart.get(item.partId)!.name },
          { projectId: project.id, verb: 'stage.renamed', targetType: 'stage', targetId: item.itemId },
        );
        counts.stages += 1;
      }
    }
    if (useEdited) {
      for (const item of diff.edited.filter((edit) => edit.stage)) {
        applyPatch(
          ctx, ctx.state.stages[item.itemId], { name: stagePart.get(item.partId)!.name },
          { projectId: project.id, verb: 'stage.renamed', targetType: 'stage', targetId: item.itemId },
        );
        counts.edited += 1;
      }
    }
    const wanted = [
      ...(choices.add ? diff.add : []).map((part) => ({ part, back: false })),
      ...(choices.bringBack ? diff.dropped : []).map((part) => ({ part, back: true })),
    ];
    const stageParts = wanted.filter(({ part }) => part.stagePartId === null);
    // A task comes in when its stage is in the project, or comes in now.
    const newStageParts = new Set(stageParts.map(({ part }) => part.partId));
    const taskParts = wanted.filter(({ part }) => part.stagePartId !== null && (newStageParts.has(part.stagePartId) || stageIdOf(part.stagePartId) !== undefined));
    // The apply of a template to an ongoing project: the added parts start today when the dates of the template are past (shiftAdded).
    const shifted = applying && plan
      ? shiftAdded(plan, { taskIds: taskParts.map(({ part }) => part.partId), stageIds: stageParts.map(({ part }) => part.partId) }, ctx.today)
      : null;
    const stageDates = (partId: string) => (shifted ? shifted.stages[partId] : plan?.stages[partId]);
    const taskDates = (partId: string) => (shifted ? shifted.tasks[partId] : plan?.tasks[partId]);
    let order = Math.max(-1, ...stagesOf(ctx.state, project.id).map((stage) => stage.order));
    for (const { part, back } of stageParts) {
      const id = nextId(ctx.state, 'stg');
      const dates = stageDates(part.partId);
      order += 1;
      const stage: Stage = {
        id, projectId: project.id, name: part.title, order, startDate: dates?.startDate ?? null, endDate: dates?.endDate ?? null,
        templatePartId: part.partId,
      };
      ctx.state.stages[id] = stage;
      recordCreate(ctx, { projectId: project.id, verb: 'stage.created', targetType: 'stage', targetId: id, entity: stage });
      counts[back ? 'broughtBack' : 'added'] += 1;
      if (back) restored.add(part.partId);
    }

    // Removed tasks: only an open task that nobody started goes, and only when the Admin picks it.
    if (choices.removed === 'delete_unstarted') {
      for (const item of diff.removed) {
        const task = ctx.state.tasks[item.itemId];
        if (task.status !== 'todo') continue;
        recordDelete(ctx, { projectId: project.id, verb: 'task.deleted', targetType: 'task', targetId: task.id, entity: task });
        delete ctx.state.tasks[task.id];
        counts.removed += 1;
      }
    }

    // New tasks: the tasks of the template that the project lacks, and the dropped ones that come back. A task waits for the tasks
    // that its template task waits for, when those are in the project or made in this update.
    const taskWanted = taskParts.flatMap(({ part, back }) => {
      const stageId = stageIdOf(part.stagePartId!);
      return stageId ? [{ part, back, stageId }] : [];
    });
    const idOf = new Map(taskWanted.map(({ part }) => [part.partId, nextId(ctx.state, 'tsk')]));
    const projectTaskOf = (partId: string) => Object.values(ctx.state.tasks).find((task) => task.projectId === project.id && task.templatePartId === partId);
    for (const { part, back, stageId } of taskWanted) {
      const id = idOf.get(part.partId)!;
      const templateTask = taskPart.get(part.partId)!;
      const waits = (templateTask.prerequisiteIds ?? []).flatMap((partId): string[] => {
        const waited = idOf.get(partId) ?? projectTaskOf(partId)?.id;
        return waited ? [waited] : [];
      });
      const planned = taskDates(part.partId);
      const dynamic = planned !== undefined && waits.length > 0;
      const ownerId = templateTask.roleId === null ? null : leadOf(templateTask.roleId);
      if (ownerId !== null) ensureOnTeam(ctx, project.id, ownerId, 'ownerId');
      const task: Task = {
        id, projectId: project.id, stageId, title: templateTask.title, description: templateTask.description, ownerId, status: 'todo',
        startDate: planned?.startDate ?? null, dueDate: planned?.dueDate ?? null,
        schedule: dynamic ? 'dynamic' : 'static', durationDays: dynamic ? workingDaysInclusive(planned.startDate, planned.dueDate) : null,
        flagged: false, needsReview: templateTask.needsReview || !maySkipReview,
        checklist: templateTask.checklist.map((text) => ({ id: nextId(ctx.state, 'chk'), text, done: false })),
        createdBy: ctx.actor.id, createdAt: ctx.stamp, completedAt: null, templatePartId: part.partId,
        ...(waits.length > 0 ? { prerequisiteIds: waits } : {}),
      };
      ctx.state.tasks[id] = task;
      recordCreate(ctx, { projectId: project.id, verb: 'task.created', targetType: 'task', targetId: id, entity: task });
      // The lead of a new task gets the normal new-task notice (the person who applies gets none).
      if (applying && ownerId !== null) notifyIn(ctx, { userIds: [ownerId], trigger: 'task_assigned', targetType: 'task', targetId: id });
      counts[back ? 'broughtBack' : 'added'] += 1;
      if (back) restored.add(part.partId);
    }

    // Text: the title and the description that the template changed and the team left alone, for open tasks (and for closed ones when
    // the pick says so). A description is never replaced with an empty one (textChanges).
    const retext = (item: ItemRef, fields: 'apply' | 'edited'): void => {
      const task = ctx.state.tasks[item.itemId];
      const part = taskPart.get(item.partId)!;
      const changes = textChanges(task, part, link.base?.tasks[part.id])[fields];
      if (Object.keys(changes).length === 0) return;
      applyPatch(ctx, task, changes, { projectId: project.id, verb: 'task.updated', targetType: 'task', targetId: task.id });
    };
    if (choices.text) {
      for (const item of diff.text) {
        retext(item, 'apply');
        counts.text += 1;
      }
    }
    if (choices.closed === 'text_only') {
      for (const item of diff.closed) {
        retext(item, 'apply');
        counts.closed += 1;
      }
    }
    for (const item of editedTasks) {
      retext(item, 'edited');
      counts.edited += 1;
    }

    // Dates: the planned dates, with the reason of each move in the task conversation.
    for (const item of dateItems) {
      const task = ctx.state.tasks[item.itemId];
      const planned = plan?.tasks[item.partId];
      if (planned === undefined) continue;
      const changes = plannedChanges(task, planned);
      const move = dateMoveOf(task, changes);
      applyPatch(ctx, task, changes, { projectId: project.id, verb: 'task.updated', targetType: 'task', targetId: task.id });
      if (move && input.dateReason) insertComment(ctx, 'task', task.id, project.id, input.dateReason, [], move);
      if (diff.dates.includes(item)) counts.dates += 1;
    }

    // Leads: the new person of the role. The person joins the team, and gets the assignment notice.
    if (choices.leads) {
      for (const item of diff.leads) {
        const task = ctx.state.tasks[item.itemId];
        const part = taskPart.get(item.partId)!;
        const role = part.roleId === null ? undefined : rolePart.get(part.roleId);
        if (!role) continue;
        const person = role.defaultUserId;
        if (person !== null) ensureOnTeam(ctx, project.id, person, 'ownerId');
        const changes: Partial<Task> = { ownerId: person };
        if (person !== null && (task.helperIds ?? []).includes(person)) changes.helperIds = (task.helperIds ?? []).filter((id) => id !== person);
        applyPatch(ctx, task, changes, { projectId: project.id, verb: 'task.reassigned', targetType: 'task', targetId: task.id });
        if (person !== null) notifyIn(ctx, { userIds: [person], trigger: 'task_assigned', targetType: 'task', targetId: task.id });
        counts.leads += 1;
      }
    }

    // The link: the template's people for the roles (when the lead pick is on), the dropped parts that came back, and the time.
    const rolePeople = choices.leads
      ? Object.fromEntries(template.roles.map((role) => [role.id, role.defaultUserId !== null && active(role.defaultUserId) ? role.defaultUserId : null]))
      : { ...link.rolePeople };
    const closing = applyPatch(ctx, project, {
      templateLink: {
        ...link, syncedAt: ctx.stamp, rolePeople, droppedPartIds: link.droppedPartIds.filter((id) => !restored.has(id)),
        base: nextBase(template, plan, link.base, diff, choices),
      },
    }, { projectId: project.id, verb: applying ? 'project.template_applied' : 'project.template_synced', targetType: 'project', targetId: project.id });
    // The History line of the apply counts what came in. The event keeps the numbers, so a feed read needs no other event.
    if (applying && closing) {
      (closing.after as Record<string, unknown>).addedParts = { stages: stageParts.length, tasks: taskWanted.length };
    }
    watch.finish({ ask: false });
    touch(ctx, project.id);
    return counts;
  },
});

export const projectTemplateCalls = {
  'projectTemplates.list': projectTemplatesList,
  'projectTemplates.save': projectTemplatesSave,
  'projectTemplates.delete': projectTemplatesDelete,
  'projectTemplates.matchPlan': projectTemplatesMatchPlan,
  'projectTemplates.link': projectTemplatesLink,
  'projectTemplates.usage': projectTemplatesUsage,
  'projectTemplates.syncPlan': projectTemplatesSyncPlan,
  'projectTemplates.syncApply': projectTemplatesSyncApply,
};
