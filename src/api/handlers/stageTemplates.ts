import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { StageName, StageTemplate, StageTemplateId } from '../contract/entities';
import { forbidden, invalid, notFound } from '../errors';
import { recordCreate, recordDelete } from '../events';
import { nextId, stageTemplatesOf } from '../store';
import { assertCan } from './shared';

const TemplateName = z.string().trim().min(1).max(60);

/** A template as a screen reads it: the name of the person who saved it, and whether the current person may delete it. */
export const StageTemplateRow = StageTemplate.extend({ createdByName: z.string(), canDelete: z.boolean() });

function mayDelete(ctx: Ctx, template: StageTemplate): boolean {
  return ctx.authority.active && (ctx.authority.systemRole === 'admin' || template.createdBy === ctx.authority.id);
}

const stageTemplatesList = defineCall({
  input: z.object({}),
  output: z.array(StageTemplateRow),
  readOnly: true,
  run(_input, ctx) {
    return Object.values(stageTemplatesOf(ctx.state))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ ...t, createdByName: ctx.state.users[t.createdBy]?.name ?? '', canDelete: mayDelete(ctx, t) }));
  },
});

const stageTemplatesSave = defineCall({
  input: z.object({ name: TemplateName, stages: z.array(StageName).min(1).max(20) }),
  output: StageTemplateRow,
  run(input, ctx) {
    assertCan(ctx, 'project.create');
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
    return { ...template, createdByName: ctx.authority.name, canDelete: true };
  },
});

const stageTemplatesDelete = defineCall({
  input: z.object({ id: StageTemplateId }),
  output: z.object({ ok: z.literal(true) }),
  run(input, ctx) {
    const templates = stageTemplatesOf(ctx.state);
    const template = templates[input.id];
    if (!template) throw notFound('Stage template', input.id);
    if (!mayDelete(ctx, template)) throw forbidden('Only the person who saved this template or the Admin can delete it.');
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
