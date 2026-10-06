import type { Ctx } from '../registry';
import type { FileRec } from '../contract/entities';
import { invalid } from '../errors';
import { can, projectRoleOf } from '../permissions';

function requireFiles(ctx: Ctx, fileIds: string[]): FileRec[] {
  return fileIds.map((id) => {
    const file = ctx.state.files[id];
    if (!file) throw invalid('fileIds', 'A file does not exist.', 'file_missing');
    return file;
  });
}

/** The people who may share a project file: the leader, the team and the Admin. These are the people of the project chat. */
export function mayShareProjectFile(ctx: Ctx, projectId: string, userId: string): boolean {
  const user = ctx.state.users[userId];
  return user !== undefined && can(user, 'chat.project', { projectRole: projectRoleOf(ctx.state, projectId, userId) });
}

/** A file of an office task stays on its task: no chat and no other task carries it (owner, 2026-10-06). */
function officeFileStays(): never {
  throw invalid('fileIds', 'A file of an office task stays on its task.', 'file_office_task');
}

/**
 * A comment or a project chat message carries only files of its own project. A comment on an office task (projectId null, with
 * officeTaskId) carries only files of that task.
 */
export function assertFilesInProject(ctx: Ctx, fileIds: string[], projectId: string | null, officeTaskId?: string): void {
  for (const file of requireFiles(ctx, fileIds)) {
    if (projectId === null) {
      if (file.projectId !== null || file.taskId !== officeTaskId) officeFileStays();
    } else if (file.projectId !== projectId) {
      if (file.projectId === null) officeFileStays();
      throw invalid('fileIds', 'A file is not in this project.', 'file_other_project');
    }
  }
}

/** A direct message may carry a file when the sender and every other person of the chat both belong to the project of the file. */
export function assertFilesForDirect(ctx: Ctx, fileIds: string[], recipientIds: string[]): void {
  for (const file of requireFiles(ctx, fileIds)) {
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
