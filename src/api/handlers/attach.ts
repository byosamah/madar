import type { Ctx } from '../registry';
import type { FileRec } from '../contract/entities';
import { invalid } from '../errors';
import { can, projectRoleOf } from '../permissions';
import { ensureRights } from '../rights';
import { mayViewFile } from '../views';

/** The files by id. A file of an office task that the person does not see reads as missing, before any other rule (review 2026-10-06). */
function requireFiles(ctx: Ctx, fileIds: string[]): FileRec[] {
  return fileIds.map((id) => {
    const file = ctx.state.files[id];
    if (!file || !mayViewFile(ctx.state, ctx.authority, file)) throw invalid('fileIds', 'A file does not exist.', 'file_missing');
    return file;
  });
}

/** The people who may share a project file: the leader, the team and the Admin. These are the people of the project chat. */
export function mayShareProjectFile(ctx: Ctx, projectId: string, userId: string): boolean {
  const user = ctx.state.users[userId];
  return user !== undefined && can(ensureRights(ctx.state, user), 'chat.project', { projectRole: projectRoleOf(ctx.state, projectId, userId) });
}

/** A file of an office task stays on its task: no chat and no other task carries it (owner, 2026-10-06). */
function officeFileStays(): never {
  throw invalid('fileIds', 'A file of an office task stays on its task.', 'file_office_task');
}

/** A file of a direct chat or a group stays in its chat: no other chat, task, post or Tracker entry carries it (owner, 2026-10-19). */
function chatFileStays(): never {
  throw invalid('fileIds', 'A file of a chat stays in its chat.', 'file_chat');
}

/** A file of a meeting with no project stays with its meeting: no chat, task, post or Tracker entry carries it (wave 2). */
function meetingFileStays(): never {
  throw invalid('fileIds', 'A file of a meeting stays with its meeting.', 'file_meeting');
}

/**
 * A comment or a project chat message carries only files of its own project. A comment on an office task (projectId null, with
 * officeTaskId) carries only files of that task.
 */
export function assertFilesInProject(ctx: Ctx, fileIds: string[], projectId: string | null, officeTaskId?: string): void {
  for (const file of requireFiles(ctx, fileIds)) {
    if (file.conversationId !== undefined) chatFileStays();
    if (file.meetingId !== undefined) meetingFileStays();
    if (projectId === null) {
      if (file.projectId !== null || file.taskId !== officeTaskId) officeFileStays();
    } else if (file.projectId !== projectId) {
      if (file.projectId === null) officeFileStays();
      throw invalid('fileIds', 'A file is not in this project.', 'file_other_project');
    }
  }
}

/**
 * A direct or group message may carry a file of a project when the sender and every other person of the chat both belong to the
 * project of the file. It may carry a file of its own chat (conversationId), and a file of no other chat (owner, 2026-10-19).
 */
export function assertFilesForDirect(ctx: Ctx, fileIds: string[], recipientIds: string[], conversationId?: string): void {
  for (const file of requireFiles(ctx, fileIds)) {
    if (file.conversationId !== undefined) {
      if (file.conversationId !== conversationId) chatFileStays();
      continue;
    }
    if (file.meetingId !== undefined) meetingFileStays();
    if (file.projectId === null) officeFileStays();
    if (!mayShareProjectFile(ctx, file.projectId, ctx.authority.id)) {
      throw invalid('fileIds', 'You cannot see the project of this file.', 'file_not_visible');
    }
    for (const recipientId of recipientIds) {
      if (!mayShareProjectFile(ctx, file.projectId, recipientId)) {
        throw invalid('fileIds', 'The other person cannot see the project of this file.', 'recipient_not_on_project');
      }
    }
  }
}

/**
 * The minutes of a meeting with no project carry only files of that meeting (wave 2). A file the person cannot see, a file of another
 * meeting and a file of any other place all read as missing, so the answer tells nothing about a file the person may not know.
 */
export function assertFilesForMeeting(ctx: Ctx, fileIds: string[], meetingId: string): void {
  for (const file of requireFiles(ctx, fileIds)) {
    if (file.meetingId !== meetingId) throw invalid('fileIds', 'A file does not exist.', 'file_missing');
  }
}
