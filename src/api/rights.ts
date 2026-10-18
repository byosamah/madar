import type { OfficeRight, RoleSettings, User } from './contract/entities';
import { type Actor, DEFAULT_RIGHTS, OFFICE_RIGHTS } from './permissions';
import type { State } from './store';

/**
 * The office rights of each person (owner, 2026-10-18, fbk_014). The Admin holds every right. Management, Accounting and Member hold the
 * rights that the office settings give the role, or the defaults of permissions.ts. A Member with a custom role holds the Member rights
 * and the rights of the role. A custom role that the office no longer has leaves the Member rights.
 */

/** The rights that the office settings give a built-in role. A role without a setting holds its default. */
function roleRights(role: 'management' | 'accounting' | 'member', roles: RoleSettings | undefined): readonly OfficeRight[] {
  return roles?.rights?.[role] ?? DEFAULT_RIGHTS[role];
}

/** The office rights of one person, from the office settings. */
export function rightsOf(user: User, roles: RoleSettings | undefined): readonly OfficeRight[] {
  if (user.systemRole === 'admin') return OFFICE_RIGHTS;
  if (user.systemRole !== 'member') return roleRights(user.systemRole, roles);
  const member = roleRights('member', roles);
  const custom = user.roleId ? roles?.custom?.find((role) => role.id === user.roleId) : undefined;
  if (!custom) return member;
  return OFFICE_RIGHTS.filter((right) => member.includes(right) || custom.rights.includes(right));
}

/**
 * The person with the office rights of the office settings attached. can() reads these rights. The person is not copied: a copy
 * would read every field of the person, the preferences too.
 */
export function withOfficeRights(user: User, roles: RoleSettings | undefined): Actor {
  return Object.create(user, { officeRights: { value: rightsOf(user, roles), enumerable: true } }) as Actor;
}

/**
 * The rights that open a section of the Admin page (owner, 2026-10-18, fbk_014). sections.ts names one of them for each section that a
 * right opens (a test checks that they agree). The list stays here, because the person menu reads it and must not load the screens.
 */
export const ADMIN_PAGE_RIGHTS: readonly OfficeRight[] = ['people.manage', 'clients.manage', 'templates.manageAll'];

/**
 * True when the person sees the Admin page: the Admin always, and anyone who holds a right that opens a section. The person menu asks
 * this, with the rights that session.get attaches (officeRights), so a Member with such a right sees the page too.
 */
export function opensAdminPage(actor: Actor): boolean {
  if (actor.systemRole === 'admin') return true;
  const held = actor.officeRights ?? [];
  return ADMIN_PAGE_RIGHTS.some((right) => held.includes(right));
}

/**
 * The person with the office rights of one state attached. Every loader, server call and handler takes the person this way.
 * No check then reads the default rights of a role by mistake (owner, 2026-10-18, fbk_014).
 */
export function withRights(state: Pick<State, 'settings'>, user: User): Actor {
  return withOfficeRights(user, state.settings.roles);
}
