import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Gender, StageName, StageTemplate, StageTemplateId } from '../contract/entities';
import { forbidden, invalid, notFound } from '../errors';
import { recordCreate, recordDelete } from '../events';
import { nextId, stageTemplatesOf } from '../store';
import { namesUnder } from '../views';
import { can } from '../permissions';
import { assertCan } from './shared';

const TemplateName = z.string().trim().min(1).max(60);

/**
 * A template as a screen reads it: the name of the person who saved it, and whether the current person may delete it.
 * The gender of that person picks the Arabic verb of "saved by" (audit 2026-10-03, SHL-17).
 */
export const StageTemplateRow = StageTemplate.extend({
  createdByName: z.string(), createdByNameAr: z.string().optional(), createdByGender: Gender.optional(), canDelete: z.boolean(),
});

function mayDelete(ctx: Ctx, template: StageTemplate): boolean {
  return ctx.authority.active && (can(ctx.authority, 'templates.projectAny') || template.createdBy === ctx.authority.id);
}

const stageTemplatesList = defineCall({
  input: z.object({}),
  output: z.array(StageTemplateRow),
  readOnly: true,
  run(_input, ctx) {
    return Object.values(stageTemplatesOf(ctx.state))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ ...t, ...namesUnder('createdByName', ctx.state.users[t.createdBy]), createdByGender: ctx.state.users[t.createdBy]?.gender, canDelete: mayDelete(ctx, t) }));
  },
});

const stageTemplatesSave = defineCall({
  input: z.object({ name: TemplateName, stages: z.array(StageName).min(1).max(20) }),
  output: StageTemplateRow,
  run(input, ctx) {
    assertCan(ctx, 'templates.projectCreate');
    const templates = stageTemplatesOf(ctx.state);
    const key = input.name.toLowerCase();
    if (Object.values(templates).some((t) => t.name.toLowerCase() === key)) {
      throw invalid('name', 'A template with this name exists. Use another name.', 'duplicate_name');
    }
    const seen = new Set<string>();
    for (const stage of input.stages) {
      const lower = stage.toLowerCase();
      if (seen.has(lower)) throw invalid('stages', `The stage "${stage}" is in the list twice.`, 'duplicate_stage');
      seen.add(lower);
    }
    const id = nextId(ctx.state, 'stt');
    const template: StageTemplate = { id, name: input.name, stages: input.stages, createdBy: ctx.authority.id, createdAt: ctx.stamp };
    templates[id] = template;
    recordCreate(ctx, { projectId: null, verb: 'stageTemplate.created', targetType: 'stageTemplate', targetId: id, entity: template });
    return { ...template, ...namesUnder('createdByName', ctx.authority), createdByGender: ctx.authority.gender, canDelete: true };
  },
});

const stageTemplatesDelete = defineCall({
  input: z.object({ id: StageTemplateId }),
  output: z.object({ ok: z.literal(true) }),
  run(input, ctx) {
    const templates = stageTemplatesOf(ctx.state);
    const template = templates[input.id];
    if (!template) throw notFound('Stage template', input.id);
    if (!mayDelete(ctx, template)) throw forbidden('Only the person who saved this template, or a person with the template right, can delete it.');
    delete templates[input.id];
    recordDelete(ctx, { projectId: null, verb: 'stageTemplate.deleted', targetType: 'stageTemplate', targetId: input.id, entity: template });
    return { ok: true as const };
  },
});

export const stageTemplateCalls = {
  'stageTemplates.list': stageTemplatesList,
  'stageTemplates.save': stageTemplatesSave,
  'stageTemplates.delete': stageTemplatesDelete,
};
