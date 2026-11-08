import { can, holdsRight, type Actor, type Resource } from './permissions';

/**
 * The gates of a change to a to-do (role rights version 2, design 5.2). One function for each kind of change, so a handler, the
 * flags of a view and the Undo ask the same rule. A person who may change any to-do of the project (task.any) passes every kind. A
 * person with no such right passes a kind only for a to-do that the person leads or made, and only with the switch of that kind.
 * The rule of the people (lead, maker, helper) lives in can(); this file adds the helper tick and the maker rules.
 */

/** The kinds of change that a to-do lead or maker needs a switch for. */
export type TaskKind = 'work' | 'details' | 'dates';

/** True when the person may make this kind of change to the to-do: task.any, or the lead or maker with the switch of the kind. */
export function mayChangeTask(actor: Actor, kind: TaskKind, resource: Resource): boolean {
  return can(actor, 'task.any', resource) || can(actor, `task.${kind}`, resource);
}

/**
 * True when the person made the to-do (the person, or the person behind the agent that made it) and may act on it: on the team of
 * the project, or the place of the maker of an office to-do (task.officeAll gives that place).
 */
export function isTaskMaker(actor: Actor, resource: Resource): boolean {
  if (!actor.active || resource.makerId === undefined) return false;
  if (resource.office) return holdsRight(actor, 'task.officeAll') || resource.makerId === actor.id;
  const onProject = actor.systemRole === 'admin' || resource.projectRole === 'leader' || resource.projectRole === 'team';
  return onProject && resource.makerId === actor.id;
}

/**
 * A helper with the switch task.work (fbk_087, owner 2026-11-08): on an office to-do, or on a project to-do as the Admin, the leader or
 * a team member. The helper ticks checklist items, and sends the to-do to review when it needs review (tasks.ts adds that test).
 */
export function mayHelperWork(actor: Actor, resource: Resource): boolean {
  if (!actor.active || !(resource.helperIds ?? []).includes(actor.id) || !holdsRight(actor, 'task.work')) return false;
  return resource.office === true || actor.systemRole === 'admin' || resource.projectRole === 'leader' || resource.projectRole === 'team';
}

/**
 * Ticking a checklist item (task.work). The lead and the maker tick with the switch. A helper ticks with the switch too, beside the
 * lead. A person who may change any to-do ticks.
 */
export function mayTickChecklist(actor: Actor, resource: Resource): boolean {
  return mayChangeTask(actor, 'work', resource) || mayHelperWork(actor, resource);
}

/** Naming the lead or the helpers of an existing to-do (task.assign): a person who may change any to-do, or the maker with the switch. */
export function mayAssignTask(actor: Actor, resource: Resource): boolean {
  return can(actor, 'task.any', resource) || (isTaskMaker(actor, resource) && holdsRight(actor, 'task.assign'));
}

/**
 * The waits of a to-do (prerequisiteIds) keep their rule of before: a person who may change any to-do, or the maker with the switch
 * of the details. The lead alone does not change them.
 */
export function mayChangePrerequisites(actor: Actor, resource: Resource): boolean {
  return can(actor, 'task.any', resource) || (isTaskMaker(actor, resource) && holdsRight(actor, 'task.details'));
}

/** Deleting a to-do: a person who may change any to-do, or the maker or the lead with task.deleteOwn. */
export function mayDeleteTask(actor: Actor, resource: Resource): boolean {
  return can(actor, 'task.any', resource) || can(actor, 'task.deleteOwn', resource);
}
