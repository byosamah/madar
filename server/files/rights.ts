import type { User } from '../../src/api/contract/entities';
import { ApiError, forbidden } from '../../src/api/errors';
import { can, projectRoleOf } from '../../src/api/permissions';
import type { State } from '../../src/api/store';
import type { Db } from '../core/ports';
import type { OfficeSnapshot } from '../core/types';
import { readUsers } from './records';

/**
 * The rights check before a signed link (plan 2b, point 7; task F2). runCall already checks the actor of every call
 * (server/core/actor.ts), but a link is a key to stored data that works without Madar for its whole life, so each call and hook
 * that signs one checks again, right before it signs:
 *
 * - the person, or the person an agent acts for, must be active (else account_off, the refusal of server/core/actor.ts);
 * - then the right itself with can(): project.view for a file, content.post for an upload, admin.manage for a screenshot.
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

/** assertCan(ctx, 'project.view', { projectRole: roleIn(ctx, projectId) }) on the office snapshot. */
export function assertMayView(office: OfficeSnapshot, userId: string, projectId: string): User {
  const authority = authorityOf(officeUsers(office), userId);
  if (!authority.active || !can(authority, 'project.view', { projectRole: roleIn(office, projectId, authority.id) })) {
    throw forbidden('You cannot do this.', { action: 'project.view' });
  }
  return authority;
}

/** The view right, then content.post in the project: the rule of files.upload, checked before its upload link is signed. */
export function assertMayPost(office: OfficeSnapshot, userId: string, projectId: string): User {
  const authority = assertMayView(office, userId, projectId);
  if (!can(authority, 'content.post', { projectRole: roleIn(office, projectId, authority.id) })) throw forbidden('You cannot do this.', { action: 'content.post' });
  return authority;
}

export function assertAdmin(authority: User): void {
  if (!can(authority, 'admin.manage')) throw forbidden('You cannot do this.', { action: 'admin.manage' });
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
