import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { CommentId, FileId, MAX_ATTACHMENTS, ProjectId, Reaction, TaskId, UpdateId, type Comment, type Update } from '../contract/entities';
import { CommentView, FeedItem } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { notifyIn } from '../notify';
import { principalOf, type Resource } from '../permissions';
import { nextId } from '../store';
import { commentViewOf, feedFor, updateItemOf } from '../views';
import { mayUndoAgentChange } from './history';
import { activeMentions, assertCan, insertComment, requireProject, requireTask, roleIn, taskRole, touch } from './shared';
import { mentionedUserIds } from '../../lib/text';
import { assertFilesInProject } from './attach';

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

/**
 * The target of a comment: its project (null for an office task) and the resource of the rights there. A task comes through
 * requireTask, so an office task that the person does not see reads as missing (owner, 2026-10-06).
 */
function targetOf(ctx: Ctx, targetType: 'task' | 'update', targetId: string): { projectId: string | null; officeTaskId?: string; resource: Resource } {
  if (targetType === 'task') {
    const task = requireTask(ctx, targetId);
    return { projectId: task.projectId, ...(task.projectId === null ? { officeTaskId: task.id } : {}), resource: taskRole(ctx, task) };
  }
  const update = ctx.state.updates[targetId];
  if (!update) throw notFound('Update', targetId);
  return { projectId: update.projectId, resource: { projectRole: roleIn(ctx, update.projectId) } };
}

function newMentions(ctx: Ctx, before: string, after: string): string[] {
  const old = new Set(mentionedUserIds(before));
  return activeMentions(ctx.state, after).filter((id) => !old.has(id));
}

export const updatesList = defineCall({
  input: z.object({
    projectId: ProjectId,
    // Decisions: only the posts marked as a decision, so a team finds what it decided (owner, 2026-10-03).
    filter: z.enum(['all', 'posts', 'decisions', 'tasks', 'files']).default('all'),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.array(FeedItem),
  readOnly: true,
  run(input, ctx) {
    requireProject(ctx, input.projectId);
    return feedFor(ctx.state, input.projectId, input.filter, input.limit, ctx.authority, (event) => mayUndoAgentChange(ctx, event));
  },
});

export const updatesCreate = defineCall({
  input: z.object({ projectId: ProjectId, body: Body, fileIds: z.array(FileId).max(20).default([]), decision: z.boolean().optional() }),
  output: FeedItem,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, project.id) });
    for (const fileId of input.fileIds) {
      if (ctx.state.files[fileId]?.projectId !== project.id) throw invalid('fileIds', 'A file is not in this project.');
    }
    const id = nextId(ctx.state, 'upd');
    const update: Update = { id, projectId: project.id, authorId: ctx.actor.id, body: input.body, fileIds: input.fileIds, createdAt: ctx.stamp, editedAt: null };
    if (input.decision) update.decision = true;
    ctx.state.updates[id] = update;
    recordCreate(ctx, { projectId: project.id, verb: 'update.posted', targetType: 'update', targetId: id, entity: update });
    notifyIn(ctx, { userIds: activeMentions(ctx.state, input.body), trigger: 'mention', targetType: 'update', targetId: id });
    touch(ctx, project.id);
    return updateItemOf(ctx.state, update, ctx.authority);
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
    notifyIn(ctx, { userIds: added, trigger: 'mention', targetType: 'update', targetId: update.id });
    return updateItemOf(ctx.state, update, ctx.authority);
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
    assertCan(ctx, 'comment.read', targetOf(ctx, input.targetType, input.targetId).resource);
    return Object.values(ctx.state.comments)
      .filter((c) => c.targetType === input.targetType && c.targetId === input.targetId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((c) => commentViewOf(ctx.state, c, ctx.authority));
  },
});

export const commentsCreate = defineCall({
  input: Target.extend({ body: Body, fileIds: z.array(FileId).max(MAX_ATTACHMENTS).default([]) }),
  output: CommentView,
  run(input, ctx) {
    const { projectId, officeTaskId, resource } = targetOf(ctx, input.targetType, input.targetId);
    assertCan(ctx, 'content.post', resource);
    assertFilesInProject(ctx, input.fileIds, projectId, officeTaskId);
    const comment = insertComment(ctx, input.targetType, input.targetId, projectId, input.body, input.fileIds);
    touch(ctx, projectId);
    return commentViewOf(ctx.state, comment, ctx.authority);
  },
});

export const commentsUpdate = defineCall({
  input: z.object({ id: CommentId, body: Body }),
  output: CommentView,
  run(input, ctx) {
    const comment = requireComment(ctx, input.id);
    const { projectId, resource } = targetOf(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'content.editOwn', { ...resource, authorId: principalOf(ctx.state, comment.authorId) });
    // Madar wrote the words of its own date message, so nobody changes them. A person may fix the words of their own reason.
    if (comment.dates?.byTaskId) throw forbidden('Madar wrote this message.', { commentId: comment.id });
    const added = newMentions(ctx, comment.body, input.body);
    applyPatch(ctx, comment, { body: input.body, editedAt: ctx.stamp }, { projectId, verb: 'comment.edited', targetType: 'comment', targetId: comment.id });
    notifyIn(ctx, { userIds: added, trigger: 'mention', targetType: comment.targetType, targetId: comment.targetId });
    return commentViewOf(ctx.state, comment, ctx.authority);
  },
});

export const commentsDelete = defineCall({
  input: z.object({ id: CommentId }),
  output: Deleted,
  run(input, ctx) {
    const comment = requireComment(ctx, input.id);
    const { projectId, resource } = targetOf(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'content.editOwn', { ...resource, authorId: principalOf(ctx.state, comment.authorId) });
    // The record of why the dates of a task moved stays in the Conversation (owner, 2026-10-02).
    if (comment.dates) throw forbidden('A message about a date change stays in the Conversation.', { commentId: comment.id });
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
    const { projectId, resource } = targetOf(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'content.post', resource);
    const list = comment.reactions[input.emoji];
    const next = list.includes(ctx.actor.id) ? list.filter((id) => id !== ctx.actor.id) : [...list, ctx.actor.id];
    // One event for each change, with the agent and the person it acts for (spec 17.2, audit 2026-10-03, API-19).
    applyPatch(ctx, comment, { reactions: { ...comment.reactions, [input.emoji]: next } }, { projectId, verb: 'comment.reacted', targetType: 'comment', targetId: comment.id });
    return commentViewOf(ctx.state, comment, ctx.authority);
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
