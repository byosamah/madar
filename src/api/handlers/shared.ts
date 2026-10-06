import type { Ctx } from '../registry';
import { emptyReactions, type Comment, type DateMove, type Project, type Stage, type Task, type User } from '../contract/entities';
import { can, mayViewTask, projectRoleOf, taskResource, type Action, type ProjectRole, type Resource } from '../permissions';
import { forbidden, invalid, notFound } from '../errors';
import { recordCreate } from '../events';
import { notifyIn } from '../notify';
import { memberKey, nextId, type State } from '../store';
import { mentionedUserIds } from '../../lib/text';

export function assertCan(ctx: Ctx, action: Action, resource: Resource = {}): void {
  if (!can(ctx.authority, action, resource)) throw forbidden('You cannot do this.', { action });
}

export function roleIn(ctx: Ctx, projectId: string | null): ProjectRole {
  return projectRoleOf(ctx.state, projectId, ctx.authority.id);
}

/** The resource of a task for the person of the call: their role in its project, or the people of an office task. */
export function taskRole(ctx: Ctx, task: Task): Resource {
  return taskResource(ctx.state, task, ctx.authority.id);
}

export function requireUser(ctx: Ctx, id: string): User {
  const user = ctx.state.users[id];
  if (!user) throw notFound('User', id);
  return user;
}

export function requireProject(ctx: Ctx, id: string): Project {
  const project = ctx.state.projects[id];
  if (!project) throw notFound('Project', id);
  return project;
}

/**
 * A task by id that the person of the call may see. An office task that the person does not see reads as missing, so no call
 * tells that it exists (owner, 2026-10-06). Every task call reads its task here, so a write checks the view first.
 */
export function requireTask(ctx: Ctx, id: string): Task {
  const task = ctx.state.tasks[id];
  if (!task || !mayViewTask(ctx.state, ctx.authority, task)) throw notFound('Task', id);
  return task;
}

export function requireStage(ctx: Ctx, projectId: string, stageId: string): Stage {
  const stage = ctx.state.stages[stageId];
  if (!stage || stage.projectId !== projectId) throw invalid('stageId', 'This stage is not in the project.');
  return stage;
}

/** Marks the project as updated, for the "last update" sort. An office task has no project, so it touches nothing. */
export function touch(ctx: Ctx, projectId: string | null): void {
  if (projectId === null) return;
  const project = ctx.state.projects[projectId];
  if (project) project.updatedAt = ctx.stamp;
}

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

export function activeMentions(state: State, body: string): string[] {
  return mentionedUserIds(body).filter((id) => state.users[id]?.active === true);
}

export function insertComment(
  ctx: Ctx, targetType: 'task' | 'update', targetId: string, projectId: string | null, body: string, fileIds: string[] = [], dates?: DateMove,
): Comment {
  const id = nextId(ctx.state, 'cmt');
  const comment: Comment = {
    id, targetType, targetId, authorId: ctx.actor.id, body, reactions: emptyReactions(), fileIds, ...(dates ? { dates } : {}), createdAt: ctx.stamp, editedAt: null,
  };
  ctx.state.comments[id] = comment;
  recordCreate(ctx, { projectId, verb: 'comment.created', targetType: 'comment', targetId: id, entity: comment });
  notifyIn(ctx, { userIds: activeMentions(ctx.state, body), trigger: 'mention', targetType, targetId });
  return comment;
}

/** Adds a person to a project team with their discipline, and tells them. A person already on the team stays as they are. */
export function addMember(ctx: Ctx, projectId: string, userId: string, discipline?: string): void {
  const key = memberKey(projectId, userId);
  if (ctx.state.members[key]) return;
  const member = { projectId, userId, discipline: discipline ?? ctx.state.users[userId].discipline };
  ctx.state.members[key] = member;
  recordCreate(ctx, { projectId, verb: 'member.added', targetType: 'member', targetId: key, entity: member });
  notifyIn(ctx, { userIds: [userId], trigger: 'added_to_project', targetType: 'project', targetId: projectId });
}

/** A person who left the office gets no new work: no task to lead, help on or reply to (audit 2026-10-03, API-7). */
export function assertActive(ctx: Ctx, userId: string, field: string): void {
  if (!requireUser(ctx, userId).active) throw invalid(field, 'This person is no longer active. Pick someone else.', 'person_inactive');
}

/**
 * A person who leads a task or helps with it must be on the project team. The leader and the Admin may name someone outside it:
 * Madar adds that person to the team, with their discipline, and tells them. Anyone else gets the refusal.
 */
export function ensureOnTeam(ctx: Ctx, projectId: string, userId: string, field: 'ownerId' | 'helperIds'): void {
  const user = requireUser(ctx, userId);
  if (projectRoleOf(ctx.state, projectId, userId) !== 'other') return;
  const message = field === 'ownerId' ? 'The owner must be on the project team.' : 'A helper must be on the project team.';
  if (!can(ctx.authority, 'task.updateAny', { projectRole: roleIn(ctx, projectId) })) throw invalid(field, message, 'not_on_team');
  if (!user.active || user.kind === 'agent') throw invalid(field, 'This person cannot join the project team.', 'cannot_join');
  addMember(ctx, projectId, userId);
}
