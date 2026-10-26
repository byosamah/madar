import type { Conversation, Meeting, Task, User } from '../../src/api/contract/entities';
import { canSeeConversation, chatForUpload } from '../../src/api/chatState';
import { ApiError, forbidden, invalid, notFound } from '../../src/api/errors';
import { minutesRefusal } from '../../src/api/handlers/meetings';
import { type Actor, can, mayViewMeeting, projectResource, projectRoleOf, taskResource } from '../../src/api/permissions';
import { withOfficeRights, withRights } from '../../src/api/rights';
import type { State } from '../../src/api/store';
import type { Db } from '../core/ports';
import type { OfficeSnapshot } from '../core/types';
import { readRoles, readUsers } from './records';

/**
 * The rights check before a signed link (plan 2b, point 7; task F2). runCall already checks the actor of every call
 * (server/core/actor.ts), but a link is a key to stored data that works without Madar for its whole life, so each call and hook
 * that signs one checks again, right before it signs:
 *
 * - the person, or the person an agent acts for, must be active (else account_off, the refusal of server/core/actor.ts);
 * - then the right itself with can(): project.view for a file, file.upload for an upload, feedback.manage for a screenshot.
 *
 * can() lets an inactive person through project.view (src/api/permissions.ts), so the active check comes first and never
 * leans on can().
 */

export type UserLookup = (id: string) => User | undefined;

function accountOff(): ApiError {
  return new ApiError('unauthenticated', 'This account is turned off. Ask an Admin.', { reason: 'account_off' });
}

/** The person whose rights apply: the person, or the active person an agent acts for. */
export function authorityOf(users: UserLookup, userId: string): User {
  const user = users(userId);
  if (!user || !user.active) throw accountOff();
  if (user.kind !== 'agent') return user;
  const owner = user.ownerId ? users(user.ownerId) : undefined;
  if (!owner || owner.kind !== 'human' || !owner.active) throw accountOff();
  return owner;
}

const officeUsers = (office: OfficeSnapshot): UserLookup => (id) => office.lists.users[id];
const roleIn = (office: OfficeSnapshot, projectId: string, userId: string) => projectRoleOf(office.lists as unknown as State, projectId, userId);

/**
 * assertCan(ctx, 'project.view', ...) on the office snapshot. A project that the person does not see answers as a missing one (hidden
 * projects, owner 2026-10-22): `missing` gives the error of the thing that the call asked for (the project, or the file).
 */
export function assertMayView(office: OfficeSnapshot, userId: string, projectId: string, missing: () => ApiError = () => notFound('Project', projectId)): Actor {
  // The person carries the office rights, so a Member keeps the upload (role rights version 2: a person with none attached holds none).
  const authority = withRights(office.lists, authorityOf(officeUsers(office), userId));
  if (!authority.active || !can(authority, 'project.view', projectResource(office.lists as unknown as State, projectId, authority.id))) throw missing();
  return authority;
}

/** The view right, then file.upload in the project: the rule of files.upload, checked before its upload link is signed. */
export function assertMayPost(office: OfficeSnapshot, userId: string, projectId: string): Actor {
  const authority = assertMayView(office, userId, projectId);
  if (!can(authority, 'file.upload', { projectRole: roleIn(office, projectId, authority.id) })) throw forbidden('You cannot do this.', { action: 'file.upload' });
  return authority;
}

/**
 * The view right on an office task, for a file of that task (owner, 2026-10-06): its maker, its lead, its helpers and the Admin.
 * A task that is gone leaves its files to the Admin. The person check comes first, as for a project.
 */
export function mayViewOfficeTask(office: OfficeSnapshot, userId: string, task: Task | undefined): { authority: Actor; sees: boolean } {
  const authority = withRights(office.lists, authorityOf(officeUsers(office), userId));
  const resource = task ? taskResource(office.lists as unknown as State, task, authority.id) : { office: true };
  return { authority, sees: can(authority, 'task.view', resource) };
}

/**
 * assertCan(ctx, 'task.view', ...) for a file of an office task, right before a link is signed. A person who does not see the task
 * gets the answer of a missing file, so no answer tells that the file exists (review 2026-10-06).
 */
export function assertMayViewOfficeFile(office: OfficeSnapshot, userId: string, task: Task | undefined, fileId: string): User {
  const { authority, sees } = mayViewOfficeTask(office, userId, task);
  if (!sees) throw notFound('File', fileId);
  return authority;
}

/**
 * The view right on a file of a direct chat or a group, right before a link is signed (owner, 2026-10-19): the people who read the
 * messages of that chat, and nobody else. The Admin who is not a member, a person who left, and everyone, when the chat is gone, get the
 * answer of a missing file, with no file name. An agent acts with the rights of its person (owner, 2026-10-26): the agent of a member opens
 * the file, and the agent of a person who is no member gets the same answer as that person.
 */
export function assertMayViewChatFile(office: OfficeSnapshot, userId: string, conversationId: string, fileId: string): User {
  const authority = withRights(office.lists, authorityOf(officeUsers(office), userId));
  const conversation = office.lists.conversations[conversationId];
  if (!conversation || !canSeeConversation(office.lists as unknown as State, conversation, authority)) throw notFound('File', fileId);
  return authority;
}

/** The chat that a person may start an upload for: chatForUpload on the office snapshot, after the person check. */
export function assertMayUploadToChat(office: OfficeSnapshot, userId: string, conversationId: string): Conversation {
  const authority = withRights(office.lists, authorityOf(officeUsers(office), userId));
  return chatForUpload(office.lists as unknown as State, conversationId, authority);
}

/** The State that the meeting rules read: the office lists, and the one meeting (a meeting is not an office list). */
const withMeeting = (office: OfficeSnapshot, meeting: Meeting): State => ({ ...(office.lists as unknown as State), meetings: { [meeting.id]: meeting } });

/**
 * The view right on a file of a meeting with no project, right before a link is signed (fbk_022, wave 2): the people who see that
 * meeting, the Admin only when invited. A person who does not see it, an agent, and everyone when the meeting is gone get the answer
 * of a missing file, with no file name. An agent never opens a meeting file, though it acts with its person's rights.
 */
export function assertMayViewMeetingFile(office: OfficeSnapshot, userId: string, meeting: Meeting | undefined, fileId: string): User {
  const authority = withRights(office.lists, authorityOf(officeUsers(office), userId));
  const actor = office.lists.users[userId];
  if (!meeting || actor?.kind === 'agent' || !mayViewMeeting(withMeeting(office, meeting), authority, meeting)) throw notFound('File', fileId);
  return authority;
}

/**
 * The meeting that a person may start an upload for: the meeting must exist and be seen by the person (else the answer of a missing
 * meeting), it must have no project, and the person must be allowed to write its minutes now (minutesRefusal). The same rule as
 * files.upload on the State (src/api/handlers/files.ts), checked before any link is signed.
 */
export function assertMayUploadToMeeting(office: OfficeSnapshot, userId: string, meeting: Meeting | undefined, meetingId: string, at: Date): Meeting {
  const authority = withRights(office.lists, authorityOf(officeUsers(office), userId));
  if (!meeting) throw notFound('Meeting', meetingId);
  const state = withMeeting(office, meeting);
  if (!mayViewMeeting(state, authority, meeting)) throw notFound('Meeting', meetingId);
  if (meeting.projectId !== null) throw invalid('meetingId', 'A meeting with a project uses the files of its project. Name the project.', 'file_meeting');
  const refusal = minutesRefusal(state, meeting, authority, at);
  if (refusal) throw refusal;
  return meeting;
}

/**
 * The right to read the reports of people (feedback.manage), checked in a hook right before a screenshot link is signed. The Admin holds
 * it, and so does a role that the Admin gave it. A hook has no office snapshot, so the roles come from the settings row. The person is the
 * person of an agent, as loadAuthority reads it.
 */
export async function assertMayReadReports(db: Db, userId: string): Promise<void> {
  const authority = await loadAuthority(db, userId);
  if (!can(withOfficeRights(authority, await readRoles(db)), 'feedback.manage')) throw forbidden('You cannot do this.', { action: 'feedback.manage' });
}

/** The authority of a hook, which has no office snapshot: the person, and for an agent its person, read with SQL. */
export async function loadAuthority(db: Db, userId: string): Promise<User> {
  const users = await readUsers(db, [userId]);
  const user = users.get(userId);
  if (user?.kind === 'agent' && user.active && user.ownerId) {
    for (const [id, owner] of await readUsers(db, [user.ownerId])) users.set(id, owner);
  }
  return authorityOf((id) => users.get(id), userId);
}
