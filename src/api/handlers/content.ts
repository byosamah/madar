import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { CommentId, FileId, MAX_ATTACHMENTS, MessageId, ProjectId, Reaction, TaskId, UpdateId, type Comment, type Update } from '../contract/entities';
import { CommentView, FeedItem, MessageView } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, lastTaskCopy, recordCreate, recordDelete } from '../events';
import { notifyIn } from '../notify';
import { mayViewTask, principalOf, projectResource, type Resource } from '../permissions';
import { nextId } from '../store';
import { commentViewOf, feedFor, updateItemOf } from '../views';
import { toggledReactions, toggleMessageReaction } from './chats';
import { mayUndoAgentChange } from './history';
import { activeMentions, assertCan, everyoneOfNew, insertComment, requireProject, requireReplyComment, requireTask, roleIn, taskRole, touch } from './shared';
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

/**
 * A comment by id. A comment of an office task that the person does not see (live, or deleted with its last copy) reads exactly as a
 * missing comment, so no answer tells that it exists (review 2026-10-06).
 */
function requireComment(ctx: Ctx, id: string): Comment {
  const comment = ctx.state.comments[id];
  if (!comment) throw notFound('Comment', id);
  if (comment.targetType === 'task') {
    const task = ctx.state.tasks[comment.targetId] ?? lastTaskCopy(ctx.state, comment.targetId);
    if (task && task.projectId === null && !mayViewTask(ctx.state, ctx.authority, task)) throw notFound('Comment', id);
  }
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
  return { projectId: update.projectId, resource: projectResource(ctx.state, update.projectId, ctx.authority.id) };
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
    assertCan(ctx, 'post.create', { projectRole: roleIn(ctx, project.id) });
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
    assertCan(ctx, 'post.editOwn', { projectRole: roleIn(ctx, update.projectId), authorId: principalOf(ctx.state, update.authorId) });
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
    assertCan(ctx, 'post.editOwn', { projectRole: roleIn(ctx, update.projectId), authorId: principalOf(ctx.state, update.authorId) });
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
  input: Target.extend({
    body: Body, fileIds: z.array(FileId).max(MAX_ATTACHMENTS).default([]),
    // The comment of the same task that this one answers (chat design item 10). Its author is named.
    replyToId: CommentId.optional(),
  }),
  output: CommentView,
  run(input, ctx) {
    const { projectId, officeTaskId, resource } = targetOf(ctx, input.targetType, input.targetId);
    assertCan(ctx, 'comment.create', resource);
    assertFilesInProject(ctx, input.fileIds, projectId, officeTaskId);
    if (input.replyToId !== undefined) requireReplyComment(ctx, input.targetType, input.targetId, input.replyToId);
    const comment = insertComment(ctx, input.targetType, input.targetId, projectId, input.body, input.fileIds, undefined, undefined, input.replyToId);
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
    assertCan(ctx, 'post.editOwn', { ...resource, authorId: principalOf(ctx.state, comment.authorId) });
    // Madar wrote the words of its own date message, so nobody changes them. A person may fix the words of their own reason.
    if (comment.dates?.byTaskId) throw forbidden('Madar wrote this message.', { commentId: comment.id });
    const added = newMentions(ctx, comment.body, input.body);
    // The people of @everyone are found again for the new words: a person who was not named before gets the notice for the first time.
    const task = comment.targetType === 'task' ? ctx.state.tasks[comment.targetId] : undefined;
    const named = activeMentions(ctx.state, input.body);
    const everyone = task === undefined ? [] : everyoneOfNew(ctx, task, input.body).filter((id) => !named.includes(id));
    const firstEveryone = everyone.filter((id) => !(comment.mentions ?? []).includes(id));
    const mentions = everyone.length > 0 || comment.mentions !== undefined ? { mentions: everyone } : {};
    applyPatch(ctx, comment, { body: input.body, editedAt: ctx.stamp, ...mentions }, { projectId, verb: 'comment.edited', targetType: 'comment', targetId: comment.id });
    notifyIn(ctx, { userIds: added, trigger: 'mention', targetType: comment.targetType, targetId: comment.targetId, messageId: comment.id });
    notifyIn(ctx, { userIds: firstEveryone.filter((id) => !added.includes(id)), trigger: 'mention', targetType: comment.targetType, targetId: comment.targetId, messageId: comment.id, everyone: true });
    return commentViewOf(ctx.state, comment, ctx.authority);
  },
});

export const commentsDelete = defineCall({
  input: z.object({ id: CommentId }),
  output: Deleted,
  run(input, ctx) {
    const comment = requireComment(ctx, input.id);
    const { projectId, resource } = targetOf(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'post.editOwn', { ...resource, authorId: principalOf(ctx.state, comment.authorId) });
    // The record of why the dates of a task moved stays in the Conversation (owner, 2026-10-02).
    if (comment.dates) throw forbidden('A message about a date change stays in the Conversation.', { commentId: comment.id });
    recordDelete(ctx, { projectId, verb: 'comment.deleted', targetType: 'comment', targetId: comment.id, entity: comment });
    delete ctx.state.comments[comment.id];
    return { deleted: true as const };
  },
});

export const reactionsToggle = defineCall({
  /**
   * A reaction on a task comment (today's rule, with its History event), or on a chat message (chat design item 12, no event). Exactly
   * one of commentId and messageId. An older input with commentId only stays valid.
   */
  input: z.object({ commentId: CommentId.optional(), messageId: MessageId.optional(), emoji: Reaction })
    .refine((input) => (input.commentId === undefined) !== (input.messageId === undefined), { message: 'Give commentId or messageId.' }),
  output: z.union([CommentView, MessageView]),
  run(input, ctx) {
    if (input.messageId !== undefined) return toggleMessageReaction(ctx, input.messageId, input.emoji);
    const comment = requireComment(ctx, input.commentId ?? '');
    const { projectId, resource } = targetOf(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'comment.create', resource);
    const next = toggledReactions(comment.reactions, input.emoji, ctx.actor.id);
    // One event for each change, with the agent and the person it acts for (spec 17.2, audit 2026-10-03, API-19).
    applyPatch(ctx, comment, { reactions: next }, { projectId, verb: 'comment.reacted', targetType: 'comment', targetId: comment.id });
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
