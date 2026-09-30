import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { CommentId, FileId, ProjectId, Reaction, TaskId, UpdateId, type Comment, type Update } from '../contract/entities';
import { CommentView, FeedItem } from '../contract/views';
import { invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { notify } from '../notify';
import { principalOf } from '../permissions';
import { nextId } from '../store';
import { commentViewOf, feedFor, updateItemOf } from '../views';
import { activeMentions, assertCan, insertComment, requireProject, roleIn, touch } from './shared';
import { mentionedUserIds } from '../../lib/text';

const Body = z.string().trim().min(1).max(5000);
const Target = z.object({ targetType: z.enum(['task', 'update']), targetId: z.union([TaskId, UpdateId]) });
const Deleted = z.object({ deleted: z.literal(true) });

function requireUpdate(ctx: Ctx, id: string): Update {
  const update = ctx.state.updates[id];
  if (!update) throw notFound('Update', id);
  return update;
}

function requireComment(ctx: Ctx, id: string): Comment {
  const comment = ctx.state.comments[id];
  if (!comment) throw notFound('Comment', id);
  return comment;
}

function projectOfTarget(ctx: Ctx, targetType: 'task' | 'update', targetId: string): string {
  const target = targetType === 'task' ? ctx.state.tasks[targetId] : ctx.state.updates[targetId];
  if (!target) throw notFound(targetType === 'task' ? 'Task' : 'Update', targetId);
  return target.projectId;
}

function newMentions(ctx: Ctx, before: string, after: string): string[] {
  const old = new Set(mentionedUserIds(before));
  return activeMentions(ctx.state, after).filter((id) => !old.has(id));
}

export const updatesList = defineCall({
  input: z.object({
    projectId: ProjectId,
    filter: z.enum(['all', 'posts', 'tasks', 'files']).default('all'),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.array(FeedItem),
  readOnly: true,
  run(input, ctx) {
    requireProject(ctx, input.projectId);
    return feedFor(ctx.state, input.projectId, input.filter, input.limit);
  },
});

export const updatesCreate = defineCall({
  input: z.object({ projectId: ProjectId, body: Body, fileIds: z.array(FileId).max(20).default([]) }),
  output: FeedItem,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, project.id) });
    for (const fileId of input.fileIds) {
      if (ctx.state.files[fileId]?.projectId !== project.id) throw invalid('fileIds', 'A file is not in this project.');
    }
    const id = nextId(ctx.state, 'upd');
    const update: Update = { id, projectId: project.id, authorId: ctx.actor.id, body: input.body, fileIds: input.fileIds, createdAt: ctx.stamp, editedAt: null };
    ctx.state.updates[id] = update;
    recordCreate(ctx, { projectId: project.id, verb: 'update.posted', targetType: 'update', targetId: id, entity: update });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: activeMentions(ctx.state, input.body), trigger: 'mention', targetType: 'update', targetId: id });
    touch(ctx, project.id);
    return updateItemOf(ctx.state, update);
  },
});

export const updatesUpdate = defineCall({
  input: z.object({ id: UpdateId, body: Body }),
  output: FeedItem,
  run(input, ctx) {
    const update = requireUpdate(ctx, input.id);
    assertCan(ctx, 'content.editOwn', { projectRole: roleIn(ctx, update.projectId), authorId: principalOf(ctx.state, update.authorId) });
    const added = newMentions(ctx, update.body, input.body);
    applyPatch(ctx, update, { body: input.body, editedAt: ctx.stamp }, { projectId: update.projectId, verb: 'update.edited', targetType: 'update', targetId: update.id });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: added, trigger: 'mention', targetType: 'update', targetId: update.id });
    return updateItemOf(ctx.state, update);
  },
});

export const updatesDelete = defineCall({
  input: z.object({ id: UpdateId }),
  output: Deleted,
  run(input, ctx) {
    const update = requireUpdate(ctx, input.id);
    assertCan(ctx, 'content.editOwn', { projectRole: roleIn(ctx, update.projectId), authorId: principalOf(ctx.state, update.authorId) });
    recordDelete(ctx, { projectId: update.projectId, verb: 'update.deleted', targetType: 'update', targetId: update.id, entity: update });
    delete ctx.state.updates[update.id];
    return { deleted: true as const };
  },
});

export const commentsList = defineCall({
  input: Target,
  output: z.array(CommentView),
  readOnly: true,
  run(input, ctx) {
    projectOfTarget(ctx, input.targetType, input.targetId);
    return Object.values(ctx.state.comments)
      .filter((c) => c.targetType === input.targetType && c.targetId === input.targetId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((c) => commentViewOf(ctx.state, c));
  },
});

export const commentsCreate = defineCall({
  input: Target.extend({ body: Body }),
  output: CommentView,
  run(input, ctx) {
    const projectId = projectOfTarget(ctx, input.targetType, input.targetId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, projectId) });
    const comment = insertComment(ctx, input.targetType, input.targetId, projectId, input.body);
    touch(ctx, projectId);
    return commentViewOf(ctx.state, comment);
  },
});

export const commentsUpdate = defineCall({
  input: z.object({ id: CommentId, body: Body }),
  output: CommentView,
  run(input, ctx) {
    const comment = requireComment(ctx, input.id);
    const projectId = projectOfTarget(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'content.editOwn', { projectRole: roleIn(ctx, projectId), authorId: principalOf(ctx.state, comment.authorId) });
    const added = newMentions(ctx, comment.body, input.body);
    applyPatch(ctx, comment, { body: input.body, editedAt: ctx.stamp }, { projectId, verb: 'comment.edited', targetType: 'comment', targetId: comment.id });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: added, trigger: 'mention', targetType: comment.targetType, targetId: comment.targetId });
    return commentViewOf(ctx.state, comment);
  },
});

export const commentsDelete = defineCall({
  input: z.object({ id: CommentId }),
  output: Deleted,
  run(input, ctx) {
    const comment = requireComment(ctx, input.id);
    const projectId = projectOfTarget(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'content.editOwn', { projectRole: roleIn(ctx, projectId), authorId: principalOf(ctx.state, comment.authorId) });
    recordDelete(ctx, { projectId, verb: 'comment.deleted', targetType: 'comment', targetId: comment.id, entity: comment });
    delete ctx.state.comments[comment.id];
    return { deleted: true as const };
  },
});

export const reactionsToggle = defineCall({
  input: z.object({ commentId: CommentId, emoji: Reaction }),
  output: CommentView,
  run(input, ctx) {
    const comment = requireComment(ctx, input.commentId);
    const projectId = projectOfTarget(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, projectId) });
    const list = comment.reactions[input.emoji];
    comment.reactions[input.emoji] = list.includes(ctx.actor.id) ? list.filter((id) => id !== ctx.actor.id) : [...list, ctx.actor.id];
    return commentViewOf(ctx.state, comment);
  },
});

export const contentCalls = {
  'updates.list': updatesList,
  'updates.create': updatesCreate,
  'updates.update': updatesUpdate,
  'updates.delete': updatesDelete,
  'comments.list': commentsList,
  'comments.create': commentsCreate,
  'comments.update': commentsUpdate,
  'comments.delete': commentsDelete,
  'reactions.toggle': reactionsToggle,
};
