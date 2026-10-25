import type { CustomRole, OfficeRight, RoleSettings, User } from './contract/entities';
import { type Actor, OFFICE_RIGHTS } from './permissions';
import { BASIC_ON, DEFAULT_EXTRA, dropUnmetNeeds, expandRights } from './rightsCatalog';
import type { State } from './store';

/**
 * The office rights of each person (owner, 2026-10-18, fbk_014; 118 switches since role rights version 2 (113 before hidden projects, 117 before the AI project switch), 2026-10-21). The Admin holds
 * every switch. Management, Accounting and Member hold BASIC_ON, minus the switches that the office settings turn off (`off`), plus the
 * extra switches that the settings give the role (`rights`, or the defaults of rightsCatalog.ts). A custom role holds what its record
 * says. A stored switch whose need is off counts as off (dropUnmetNeeds, fail closed): "Connect AI assistants" off turns every AI switch off.
 */

export type BuiltInRole = 'management' | 'accounting' | 'member';

/** The switches that a list of stored ids and a list of turned-off basics give: BASIC_ON minus off, plus the expanded extras, minus the switches whose need is off. */
function heldFrom(off: readonly string[], extra: readonly string[]): OfficeRight[] {
  return dropUnmetNeeds([...BASIC_ON.filter((id) => !off.includes(id)), ...expandRights(extra)]);
}

/** The switches that a built-in role holds, from the office settings. A role without a setting holds its default. */
function builtInRights(role: BuiltInRole, roles: RoleSettings | undefined): OfficeRight[] {
  return heldFrom(roles?.off?.[role] ?? [], roles?.rights?.[role] ?? DEFAULT_EXTRA[role]);
}

/**
 * The switches that a role holds, for the screens and for rightsOf. A built-in role gives its own list. A custom role without `off` (saved
 * before role rights version 2) holds the Member switches and its own: the meaning of that time. A custom role with `off` holds its own
 * full list. One function serves the role sheet, the roles list, the person sheet and the check of a person.
 */
export function heldRightsOfRole(roles: RoleSettings | undefined, role: BuiltInRole | CustomRole): readonly OfficeRight[] {
  if (typeof role === 'string') return builtInRights(role, roles);
  if (role.off !== undefined) return heldFrom(role.off, role.rights);
  return dropUnmetNeeds([...builtInRights('member', roles), ...expandRights(role.rights)]);
}

/** The office rights of one person, from the office settings. */
export function rightsOf(user: User, roles: RoleSettings | undefined): readonly OfficeRight[] {
  if (user.systemRole === 'admin') return OFFICE_RIGHTS;
  if (user.systemRole !== 'member') return builtInRights(user.systemRole, roles);
  const custom = user.roleId ? roles?.custom?.find((role) => role.id === user.roleId) : undefined;
  // A custom role that the office no longer has leaves the Member switches.
  return custom ? heldRightsOfRole(roles, custom) : builtInRights('member', roles);
}

/**
 * The person with the office rights of the office settings attached. can() reads these rights. The person is not copied: a copy
 * would read every field of the person, the preferences too.
 */
export function withOfficeRights(user: User, roles: RoleSettings | undefined): Actor {
  return Object.create(user, { officeRights: { value: rightsOf(user, roles), enumerable: true } }) as Actor;
}

/**
 * The rights that open a section of the Admin page (owner, 2026-10-18, fbk_014; the new ids since 2026-10-21). sections.ts names one of
 * them for each section that a right opens (a test checks that they agree). The list stays here, because the person menu reads it and
 * must not load the screens. People: any of the five people switches. Project templates: make, change any, or update projects.
 */
export const ADMIN_PAGE_RIGHTS: readonly OfficeRight[] = [
  'people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove', 'clients.change',
  'templates.projectCreate', 'templates.projectAny', 'templates.updateProjects', 'templates.taskAny',
  'subCompanies.manage', 'office.settings', 'feedback.manage',
];

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
 * The person with the office rights attached, once: a person who already carries them (withRights) stays as it is. The fail-closed
 * places (the people of a chat, the recipients of a notice, a file check) read other people with can(), so each one calls this first.
 */
export function ensureRights(state: Pick<State, 'settings'>, user: User): Actor {
  return 'officeRights' in user ? (user as Actor) : withOfficeRights(user, state.settings?.roles);
}

/**
 * The person with the office rights of one state attached. Every loader, server call and handler takes the person this way.
 * No check then reads the default rights of a role by mistake (owner, 2026-10-18, fbk_014).
 */
export function withRights(state: Pick<State, 'settings'>, user: User): Actor {
  return withOfficeRights(user, state.settings?.roles);
}
