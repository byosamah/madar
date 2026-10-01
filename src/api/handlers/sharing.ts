import { z } from 'zod';
import { defineCall } from '../registry';
import { FileId, MESSAGE_MAX, TaskId, UserId } from '../contract/entities';
import { canSeeConversation } from '../chatState';
import { forbidden, invalid, notFound } from '../errors';
import { assertCan, insertComment, requireTask, roleIn, touch } from './shared';
import { assertFilesForDirect } from './attach';
import { directWith, postMessage, requireDirectPartner } from './chats';

const Target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project_chat') }),
  z.object({ kind: z.literal('person'), userId: UserId }),
  z.object({ kind: z.literal('task'), taskId: TaskId }),
]);

/**
 * Posts one existing file into a chat or a task conversation. The message text is optional: without it the post is the file name.
 * The API owns the rule of who may open the file, so a screen only shows the refusal.
 */
export const filesShare = defineCall({
  input: z.object({ fileId: FileId, target: Target, message: z.string().trim().max(MESSAGE_MAX).default('') }),
  output: z.object({ kind: z.enum(['project_chat', 'person', 'task']), id: z.string() }),
  run(input, ctx) {
    const file = ctx.state.files[input.fileId];
    if (!file) throw notFound('File', input.fileId);
    const body = input.message || file.name;
    const { target } = input;
    if (target.kind === 'task') {
      const task = requireTask(ctx, target.taskId);
      if (task.projectId !== file.projectId) throw invalid('taskId', 'This task is not in the project of the file.', 'file_other_project');
      assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, task.projectId) });
      insertComment(ctx, 'task', task.id, task.projectId, body, [file.id]);
      touch(ctx, task.projectId);
      return { kind: 'task' as const, id: task.id };
    }
    if (target.kind === 'project_chat') {
      const room = Object.values(ctx.state.conversations).find((c) => c.kind === 'project' && c.projectId === file.projectId);
      if (!room) throw notFound('Conversation', file.projectId);
      if (!canSeeConversation(ctx.state, room, ctx.authority)) throw forbidden('You cannot open this chat.', { conversationId: room.id });
      postMessage(ctx, room, body, [file.id]);
      return { kind: 'project_chat' as const, id: room.id };
    }
    const other = requireDirectPartner(ctx, target.userId);
    // The check runs before the chat exists, so a refusal leaves no empty chat behind.
    assertFilesForDirect(ctx, [file.id], [other.id]);
    const room = directWith(ctx, other);
    postMessage(ctx, room, body, [file.id]);
    return { kind: 'person' as const, id: room.id };
  },
});

export const shareCalls = { 'files.share': filesShare };
