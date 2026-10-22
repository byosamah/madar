import type { Project } from './contract/entities';
import { invalid, notFound } from './errors';
import { mayViewProject } from './permissions';
import type { Ctx } from './registry';
import type { State } from './store';

/**
 * Internal projects (fbk_044, owner 2026-10-22). An internal project is the office's own work, like a portfolio. It has no client, place,
 * area, sub-company, contract date, payments or Tracker. The reason `internal_project` names that rule on the field that broke it.
 */
export const INTERNAL_REASON = 'internal_project';

/** True for an internal project. A project with no kind is a client project. */
export function isInternal(project: Pick<Project, 'kind'> | undefined | null): boolean {
  return project?.kind === 'internal';
}

/** True when the id names an internal project of the state. */
export function isInternalId(state: State, projectId: string | null): boolean {
  return projectId !== null && isInternal(state.projects[projectId]);
}

/** The refusal of a field that an internal project may not hold. */
export function internalRefusal(field: string): ReturnType<typeof invalid> {
  return invalid(field, 'An internal project has no client, code, place, area, sub-company, contract date, payments or Tracker.', INTERNAL_REASON);
}

/**
 * Stops a call that an internal project does not take (payments and the Tracker). A person who does not see the project gets the answer
 * of a missing project first, so the reason never tells that the project exists (hidden projects, owner 2026-10-22).
 */
export function assertNotInternal(ctx: Ctx, project: Project, field = 'projectId'): void {
  if (!mayViewProject(ctx.state, project, ctx.authority)) throw notFound('Project', project.id);
  if (isInternal(project)) throw internalRefusal(field);
}
