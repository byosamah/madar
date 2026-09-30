import type { Ctx } from '../registry';
import { emptyReactions, type Comment, type Project, type Stage, type Task, type User } from '../contract/entities';
import { can, projectRoleOf, type Action, type ProjectRole, type Resource } from '../permissions';
import { forbidden, invalid, notFound } from '../errors';
import { recordCreate } from '../events';
import { notify } from '../notify';
import { nextId, type State } from '../store';
import { mentionedUserIds } from '../../lib/text';

export function assertCan(ctx: Ctx, action: Action, resource: Resource = {}): void {
  if (!can(ctx.authority, action, resource)) throw forbidden('You cannot do this.', { action });
}

export function roleIn(ctx: Ctx, projectId: string): ProjectRole {
  return projectRoleOf(ctx.state, projectId, ctx.authority.id);
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

export function requireTask(ctx: Ctx, id: string): Task {
  const task = ctx.state.tasks[id];
  if (!task) throw notFound('Task', id);
  return task;
}

export function requireStage(ctx: Ctx, projectId: string, stageId: string): Stage {
  const stage = ctx.state.stages[stageId];
  if (!stage || stage.projectId !== projectId) throw invalid('stageId', 'This stage is not in the project.');
  return stage;
}

/** Marks the project as updated, for the "last update" sort. */
export function touch(ctx: Ctx, projectId: string): void {
  const project = ctx.state.projects[projectId];
  if (project) project.updatedAt = ctx.stamp;
}

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

export function activeMentions(state: State, body: string): string[] {
  return mentionedUserIds(body).filter((id) => state.users[id]?.active === true);
}

export function insertComment(ctx: Ctx, targetType: 'task' | 'update', targetId: string, projectId: string, body: string): Comment {
  const id = nextId(ctx.state, 'cmt');
  const comment: Comment = {
    id, targetType, targetId, authorId: ctx.actor.id, body, reactions: emptyReactions(), createdAt: ctx.stamp, editedAt: null,
  };
  ctx.state.comments[id] = comment;
  recordCreate(ctx, { projectId, verb: 'comment.created', targetType: 'comment', targetId: id, entity: comment });
  notify(ctx.state, ctx.actor, ctx.stamp, { userIds: activeMentions(ctx.state, body), trigger: 'mention', targetType, targetId });
  return comment;
}
