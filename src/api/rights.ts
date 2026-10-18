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

/** The person with the office rights of the office settings attached. can() reads these rights. */
export function withOfficeRights(user: User, roles: RoleSettings | undefined): Actor {
  return { ...user, officeRights: rightsOf(user, roles) };
}

/**
 * The person with the office rights of one state attached. Every loader, server call and handler takes the person this way, so no
 * check reads the default rights of a role by mistake (owner, 2026-10-18, fbk_014).
 */
export function withRights(state: Pick<State, 'settings'>, user: User): Actor {
  return withOfficeRights(user, state.settings.roles);
}
