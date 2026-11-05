import type { Ctx } from '../registry';
import type { FileRec } from '../contract/entities';
import { forbidden, invalid } from '../errors';
import { can, principalOf, projectRoleOf, type Actor } from '../permissions';
import { ensureRights } from '../rights';
import { fileInLockedFolder } from '../folderLock';
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

/** A file of a locked folder stays in its folder: no chat, task, post or Tracker entry carries it (fbk_074). The person already sees the file, so the refusal tells nothing. */
function lockedFileStays(): never {
  throw invalid('fileIds', 'A file of a locked folder stays in its folder.', 'file_locked');
}

/** A file of Resources stays on the Resources page: no chat, task, post or Tracker entry carries it (fbk_078). The person already sees the file, so the refusal tells nothing. */
function resourceFileStays(): never {
  throw invalid('fileIds', 'A file of Resources stays on the Resources page.', 'file_resource');
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
    if (file.resource === true) resourceFileStays();
    if (fileInLockedFolder(ctx.state, file)) lockedFileStays();
    if (projectId === null) {
      if (file.projectId !== null || file.taskId !== officeTaskId) officeFileStays();
    } else if (file.projectId !== projectId) {
      if (file.projectId === null) officeFileStays();
      throw invalid('fileIds', 'A file is not in this project.', 'file_other_project');
    }
  }
}

/**
 * The switch "Share files" in a project chat and on the comments of a project to-do or post (owner, 2026-11-03: "Server follows switch").
 * The catalog says "Share a project file into a chat or a to-do", and files.share asks the switch for every target. These calls also carry
 * the files that the person uploaded for the message, so without the switch the person, or the agent of the person, may attach only a file
 * whose newest version the person or that agent uploaded. Call it after assertFilesInProject: a file that the person may not open reads as
 * missing first, so the refusal tells nothing about it.
 */
export function assertShareSwitchInProject(ctx: Ctx, fileIds: string[]): void {
  if (fileIds.length === 0 || can(ctx.authority, 'file.share')) return;
  for (const id of fileIds) {
    const newest = ctx.state.files[id]?.versions.at(-1);
    if (!newest || principalOf(ctx.state, newest.uploadedBy) !== ctx.authority.id) throw forbidden('You cannot do this.', { action: 'file.share' });
  }
}

/**
 * A direct or group message may carry a file of a project when the sender and every other person of the chat both belong to the
 * project of the file. It may carry a file of its own chat (conversationId), and a file of no other chat (owner, 2026-10-19).
 */
export function assertFilesForDirect(ctx: Ctx, fileIds: string[], recipientIds: string[], conversationId?: string): void {
  let blockOf: ReturnType<typeof shareRuleOf> | undefined;
  for (const file of requireFiles(ctx, fileIds)) {
    if (file.conversationId !== undefined) {
      if (file.conversationId !== conversationId) chatFileStays();
      continue;
    }
    if (file.meetingId !== undefined) meetingFileStays();
    if (file.resource === true) resourceFileStays();
    if (file.projectId === null) officeFileStays();
    if (fileInLockedFolder(ctx.state, file)) lockedFileStays();
    // A project file goes into a direct chat or a group only with the switch "Share files", as files.share asks it (fbk_070).
    if (!can(ctx.authority, 'file.share')) throw forbidden('You cannot do this.', { action: 'file.share' });
    blockOf ??= shareRuleOf(ctx, recipientIds);
    const block = blockOf(file.projectId);
    if (block === 'file_not_visible') throw invalid('fileIds', 'You cannot see the project of this file.', block);
    if (block === 'recipient_not_on_project') throw invalid('fileIds', 'The other person cannot see the project of this file.', block);
  }
}

/**
 * The one rule of a project file in a direct chat or a group (fbk_070): the sender and every other active person of the chat (the callers
 * pass `chatMemberIds`, so a person whom an Admin turned off does not count, review 2026-11-03) must be on the
 * project. It gives the reason that stops the file, or null when the file may go. The check of chats.send (assertFilesForDirect) and the
 * list of the picker (chats.insertProjects) both ask it, so the picker never lists a project that Send then refuses.
 */
export function shareBlockOf(ctx: Ctx, projectId: string, recipientIds: string[]): ShareBlock {
  return shareRuleOf(ctx, recipientIds)(projectId);
}

type ShareBlock = 'file_not_visible' | 'recipient_not_on_project' | null;

/**
 * The rule of shareBlockOf for many projects (review 2026-11-03): chats.insertProjects asks it for every project of the office. The rights
 * of each person of the chat do not change from one project to the next, so they are built once here, not once for each project. Only the
 * place of each person on the project (projectRoleOf) is read for each project. The answer is the one of mayShareProjectFile.
 */
export function shareRuleOf(ctx: Ctx, recipientIds: string[]): (projectId: string) => ShareBlock {
  const rightsOf = (userId: string): Actor | undefined => {
    const user = ctx.state.users[userId];
    return user === undefined ? undefined : ensureRights(ctx.state, user);
  };
  const sender = rightsOf(ctx.authority.id);
  const others = recipientIds.map((userId) => ({ userId, actor: rightsOf(userId) }));
  const mayShare = (actor: Actor | undefined, userId: string, projectId: string): boolean =>
    actor !== undefined && can(actor, 'chat.project', { projectRole: projectRoleOf(ctx.state, projectId, userId) });
  return (projectId) => {
    if (!mayShare(sender, ctx.authority.id, projectId)) return 'file_not_visible';
    return others.every(({ userId, actor }) => mayShare(actor, userId, projectId)) ? null : 'recipient_not_on_project';
  };
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
