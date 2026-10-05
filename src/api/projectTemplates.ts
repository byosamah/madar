import type { ProjectTemplate, StageTemplate } from './contract/entities';

/**
 * A stage template as a project template: the same name, author and time, its stages in order with no dates, no roles and
 * no tasks (owner, 2026-10-05: stage templates merge into project templates). The prototype step of version 9 and the SQL
 * migration 20261005000100_project_templates.sql make the same record.
 */
export function projectTemplateFromStages(template: StageTemplate, id: string): ProjectTemplate {
  return {
    id,
    name: template.name,
    roles: [],
    stages: template.stages.map((name, i) => ({ id: `s${i + 1}`, name, startOffset: null, durationDays: null })),
    tasks: [],
    createdBy: template.createdBy,
    createdAt: template.createdAt,
    updatedAt: template.createdAt,
  };
}
