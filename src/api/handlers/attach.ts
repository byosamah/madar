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

/** A comment or a project chat message carries only files of its own project. */
export function assertFilesInProject(ctx: Ctx, fileIds: string[], projectId: string): void {
  for (const file of requireFiles(ctx, fileIds)) {
    if (file.projectId !== projectId) throw invalid('fileIds', 'A file is not in this project.', 'file_other_project');
  }
}

/** A direct message may carry a file when the sender and every other person of the chat both belong to the project of the file. */
export function assertFilesForDirect(ctx: Ctx, fileIds: string[], recipientIds: string[]): void {
  for (const file of requireFiles(ctx, fileIds)) {
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
