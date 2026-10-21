import { z } from 'zod';
import { defineCall } from '../registry';
import { FileId, MESSAGE_MAX, TaskId, UserId } from '../contract/entities';
import { canSeeConversation } from '../chatState';
import { forbidden, invalid, notFound } from '../errors';
import { assertCan, insertComment, requireTask, taskRole, touch } from './shared';
import { mayViewFile } from '../views';
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
    // A file of an office task that the person does not see reads as missing (owner, 2026-10-06).
    if (!file || !mayViewFile(ctx.state, ctx.authority, file)) throw notFound('File', input.fileId);
    // A file of a direct chat or a group stays in its chat (owner, 2026-10-19).
    if (file.conversationId !== undefined) throw invalid('target', 'A file of a chat stays in its chat.', 'file_chat');
    // A file of a meeting stays with its meeting (wave 2).
    if (file.meetingId !== undefined) throw invalid('target', 'A file of a meeting stays with its meeting.', 'file_meeting');
    // Sharing a file needs file.share. A share into a chat also needs the chat switch: postMessage asks it (chat.project or chat.direct).
    assertCan(ctx, 'file.share');
    const body = input.message || file.name;
    const { target } = input;
    if (target.kind === 'task') {
      const task = requireTask(ctx, target.taskId);
      // A file of an office task goes only into the Conversation of its own task.
      if (file.projectId === null && task.id !== file.taskId) throw invalid('taskId', 'A file of an office task stays on its task.', 'file_office_task');
      if (task.projectId !== file.projectId) throw invalid('taskId', 'This task is not in the project of the file.', 'file_other_project');
      assertCan(ctx, 'comment.create', taskRole(ctx, task));
      insertComment(ctx, 'task', task.id, task.projectId, body, [file.id]);
      touch(ctx, task.projectId);
      return { kind: 'task' as const, id: task.id };
    }
    if (file.projectId === null) throw invalid('target', 'A file of an office task stays on its task.', 'file_office_task');
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
