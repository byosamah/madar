import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import {
  Gender,
  Client, ClientId, ClientInitials, Glass, Language, OfficeRight, RoleId, Settings, SystemRole, Theme, User, UserAvatarInput, UserId, defaultPreferences,
  type Preferences,
} from '../contract/entities';
import { UserCard } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate } from '../events';
import { nextId } from '../store';
import { userCard } from '../views';
import { holdsAdminRights } from '../permissions';
import { assertCan, byName, requireUser } from './shared';

const Empty = z.object({});
const Name = z.string().trim().min(1).max(80);
/** The Arabic name in a change: an empty value takes it off (owner item 12, 2026-10-05). */
const NameArPatch = z.string().trim().max(80);
const Discipline = z.string().trim().min(1).max(40);
const Kind = z.enum(['human', 'agent']);
const ClientName = z.string().trim().max(120);

/** A client needs a name in English or in Arabic (colleague comment 11). */
function assertClientNamed(client: { name: string; nameAr?: string }) {
  if (!client.name.trim() && !client.nameAr?.trim()) throw invalid('name', 'Write the client name in English or in Arabic.', 'client_name_missing');
}
const ContactName = z.string().trim().max(80);
const Phone = z.string().trim().max(40);
const ClientEmail = z.union([z.email(), z.literal('')]);

const PreviewUser = UserCard.extend({
  systemRole: SystemRole,
  hint: z.enum(['admin', 'management', 'accounting', 'leader', 'member', 'agent']),
  actingForName: z.string().nullable(),
  /** The Arabic name of the person an agent acts for, when there is one. */
  actingForNameAr: z.string().optional(),
});

export const sessionGet = defineCall({
  input: Empty,
  output: z.object({
    user: User,
    /** The office rights of the authority, so the screens check a right the way the server does (fbk_014). */
    authority: User.extend({ officeRights: z.array(OfficeRight).optional() }),
    actingFor: UserCard.nullable(), previewUsers: z.array(PreviewUser), persistent: z.boolean(), simulateErrors: z.boolean(),
    /** The real build: the file limit of the active file store, so the screens check before an upload (plan 2b, point 1). */
    limits: z.object({ maxFileBytes: z.number().int().positive() }).optional(),
  }),
  readOnly: true,
  prototypeOnly: true,
  run(_input, ctx) {
    const leaders = new Set(Object.values(ctx.state.projects).map((p) => p.leaderId));
    // An agent shows only while its person is active, because it cannot act otherwise.
    const canAct = (u: User) => u.kind === 'human' || (u.ownerId !== null && ctx.state.users[u.ownerId]?.active === true);
    const previewUsers = Object.values(ctx.state.users)
      .filter((u) => u.active && canAct(u))
      .sort(byName)
      .map((u) => ({
        ...userCard(u),
        systemRole: u.systemRole,
        actingForName: u.kind === 'agent' && u.ownerId ? (ctx.state.users[u.ownerId]?.name ?? null) : null,
        ...(u.kind === 'agent' && u.ownerId && ctx.state.users[u.ownerId]?.nameAr ? { actingForNameAr: ctx.state.users[u.ownerId]?.nameAr } : {}),
        hint: u.kind === 'agent' ? ('agent' as const) : u.systemRole !== 'member' ? u.systemRole : leaders.has(u.id) ? ('leader' as const) : ('member' as const),
      }));
    const actingFor = ctx.actor.kind === 'agent' ? userCard(ctx.authority) : null;
    // "authority" is the person whose rights and notification choices apply: the user, or the person an agent acts for.
    return {
      user: ctx.actor, authority: ctx.authority, actingFor, previewUsers, persistent: ctx.persistent, simulateErrors: ctx.state.session.simulateErrors,
      ...(ctx.limits ? { limits: ctx.limits } : {}),
    };
  },
});

export const sessionPreviewAs = defineCall({
  input: z.object({ userId: UserId }),
  output: z.object({ user: User }),
  prototypeOnly: true,
  run(input, ctx) {
    const user = requireUser(ctx, input.userId);
    if (!user.active) throw invalid('userId', 'This person is not active.');
    const owner = user.ownerId ? ctx.state.users[user.ownerId] : undefined;
    if (user.kind === 'agent' && !owner?.active) throw invalid('userId', 'This agent has no active person to act for.');
    ctx.state.session.currentUserId = user.id;
    return { user };
  },
});

export const sessionSetSimulateErrors = defineCall({
  input: z.object({ on: z.boolean() }),
  output: z.object({ simulateErrors: z.boolean() }),
  prototypeOnly: true,
  run(input, ctx) {
    ctx.state.session.simulateErrors = input.on;
    return { simulateErrors: input.on };
  },
});

export const usersList = defineCall({
  input: z.object({ includeInactive: z.boolean().default(false) }),
  output: z.array(User),
  readOnly: true,
  run(input, ctx) {
    // A removed person is in no list (owner, 2026-10-12). users.get still gives the record, for the name in the History.
    return Object.values(ctx.state.users).filter((u) => !u.removed && (input.includeInactive || u.active)).sort(byName);
  },
});

export const usersGet = defineCall({
  input: z.object({ id: UserId }),
  output: User,
  readOnly: true,
  run(input, ctx) {
    return requireUser(ctx, input.id);
  },
});

function assertEmailFree(ctx: Ctx, email: string, exceptId: string | null): void {
  const taken = Object.values(ctx.state.users).some((u) => u.id !== exceptId && u.email.toLowerCase() === email.toLowerCase());
  if (taken) throw invalid('email', 'This email is already in use.', 'email_taken');
}

/** Spec 17.1: an agent has no role of its own. It acts with the rights of its person. */
function agentAdmin() {
  return invalid('systemRole', 'An agent cannot be an Admin. It has the rights of the person it acts for.', 'agent_admin');
}

/** An agent is always a member. Admin keeps its own message. */
function assertAgentRole(role: SystemRole | undefined): void {
  if (role === 'admin') throw agentAdmin();
  if (role !== undefined && role !== 'member') throw invalid('systemRole', 'An agent has no role of its own. It has the rights of the person it acts for.', 'agent_role');
}

/**
 * Management makes and changes people, but never makes an Admin and never changes one. An agent acts with the rights of its
 * owner, so Management never adds an agent, and never changes an agent of an Admin. Only an Admin does these things.
 */
function assertMayTouch(ctx: Ctx, target: User | null, newRole: SystemRole | undefined, addsAgent = false): void {
  if (ctx.authority.systemRole === 'admin') return;
  if (addsAgent) throw forbidden('Only an Admin can add an agent.', { action: 'people.manage' });
  if (newRole === 'admin') throw forbidden('Only an Admin can make someone an Admin.', { action: 'people.manage' });
  if (holdsAdminRights(ctx.state, target)) throw forbidden('Only an Admin can change an Admin or the agent of an Admin.', { action: 'people.manage' });
}

/**
 * Only the Admin changes the role of a person: its systemRole and its custom role (owner, 2026-10-18). A value that stays the same is
 * no change, so a plain save of Management still goes through. A new person has the Member role and no custom role.
 */
function assertMayChangeRole(ctx: Ctx, target: User | null, next: { systemRole?: SystemRole; roleId?: string | null }): void {
  if (ctx.authority.systemRole === 'admin') return;
  const systemRoleChanged = next.systemRole !== undefined && next.systemRole !== (target?.systemRole ?? 'member');
  const roleIdChanged = next.roleId !== undefined && next.roleId !== (target?.roleId ?? null);
  if (systemRoleChanged || roleIdChanged) throw forbidden('Only an Admin changes the role of a person.', { action: 'people.manage', reason: 'admin_only' });
}

/** A custom role names a role of the office, and only a Member holds one (owner, 2026-10-18). */
function assertCustomRole(ctx: Ctx, systemRole: SystemRole, roleId: string | null | undefined): void {
  if (!roleId) return;
  if (systemRole !== 'member') throw invalid('roleId', 'Only a Member holds a custom role.', 'role_not_member');
  if (!ctx.state.settings.roles?.custom?.some((role) => role.id === roleId)) throw invalid('roleId', 'This role does not exist.', 'role_missing');
}

/** An agent has no role of its own, so it holds no custom role either (spec 17.1). */
function assertAgentNoCustomRole(roleId: string | null | undefined): void {
  if (roleId) throw invalid('roleId', 'An agent has no role of its own. It has the rights of the person it acts for.', 'agent_role');
}

export const usersCreate = defineCall({
  input: z.object({
    name: Name,
    /** The Arabic name. Optional in the contract, so old callers work; the Admin form asks for it (owner item 12). */
    nameAr: Name.optional(),
    email: z.email(),
    systemRole: SystemRole.default('member'),
    kind: Kind.default('human'),
    discipline: Discipline,
    ownerId: UserId.optional(),
    gender: Gender.optional(),
    /** The language of the person's screens and emails. Missing: the language of the person who creates them (plan 4.13, A8). */
    language: Language.optional(),
    /** The custom role of a Member (fbk_014). Only the Admin gives one. */
    roleId: RoleId.optional(),
  }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'people.manage');
    assertMayTouch(ctx, null, input.systemRole, input.kind === 'agent');
    assertMayChangeRole(ctx, null, { systemRole: input.systemRole, roleId: input.roleId });
    assertCustomRole(ctx, input.systemRole, input.roleId);
    assertEmailFree(ctx, input.email, null);
    if (input.kind === 'agent') {
      assertAgentRole(input.systemRole);
      assertAgentNoCustomRole(input.roleId);
    }
    let ownerId: string | null = null;
    if (input.kind === 'agent') {
      const owner = input.ownerId ? ctx.state.users[input.ownerId] : undefined;
      if (!owner || owner.kind !== 'human' || !owner.active) throw invalid('ownerId', 'An agent needs an active person to act for.');
      ownerId = owner.id;
    } else if (input.ownerId) {
      throw invalid('ownerId', 'Only an agent acts for a person.');
    }
    const id = nextId(ctx.state, 'usr');
    const user: User = {
      id, name: input.name, ...(input.nameAr ? { nameAr: input.nameAr } : {}), email: input.email, systemRole: input.systemRole, kind: input.kind,
      discipline: input.discipline, ownerId, avatarUrl: null, active: true, gender: input.gender,
      preferences: { ...defaultPreferences(), language: input.language ?? ctx.authority.preferences.language },
      ...(input.roleId ? { roleId: input.roleId } : {}),
    };
    ctx.state.users[id] = user;
    recordCreate(ctx, { projectId: null, verb: 'user.created', targetType: 'user', targetId: id, entity: user });
    return user;
  },
});

export const usersUpdate = defineCall({
  input: z.object({
    id: UserId,
    patch: z.object({
      name: Name.optional(),
      nameAr: NameArPatch.optional(),
      email: z.email().optional(),
      systemRole: SystemRole.optional(),
      discipline: Discipline.optional(),
      avatarUrl: UserAvatarInput.optional(),
      gender: Gender.optional(),
      /** The custom role of a Member. null takes it off. Only the Admin changes it (fbk_014). */
      roleId: RoleId.nullable().optional(),
    }).strict(), // A person never becomes an agent, or back: that would break the owner rule of spec 17.
  }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'people.manage');
    const user = requireUser(ctx, input.id);
    assertNotRemoved(user);
    assertMayTouch(ctx, user, input.patch.systemRole);
    assertMayChangeRole(ctx, user, { systemRole: input.patch.systemRole, roleId: input.patch.roleId });
    if (input.patch.email !== undefined && input.patch.email.toLowerCase() !== user.email.toLowerCase()) {
      // The sign-in email is the key to the account: Auth takes the new email as confirmed, and "Forgot password" goes there.
      // So only an Admin changes it, and never through an agent (security review of P2, 2026-10-04).
      if (ctx.authority.systemRole !== 'admin' || ctx.actor.kind === 'agent') {
        throw forbidden('Only an Admin can change the email of a person.', { action: 'people.email' });
      }
      assertEmailFree(ctx, input.patch.email, user.id);
    }
    if (user.kind === 'agent') {
      assertAgentRole(input.patch.systemRole);
      assertAgentNoCustomRole(input.patch.roleId);
    }
    if (input.patch.systemRole !== undefined && input.patch.systemRole !== 'admin' && user.systemRole === 'admin') {
      // Only people count: an agent acts with its person's rights, so an agent can never keep the office's Admin work going.
      const admins = Object.values(ctx.state.users).filter((u) => u.kind === 'human' && u.systemRole === 'admin' && u.active);
      if (admins.length <= 1) throw invalid('systemRole', 'The office needs at least one Admin.', 'last_admin');
    }
    // A person who stops being a Member loses the custom role. Only a Member holds one.
    const nextRole = input.patch.systemRole ?? user.systemRole;
    const roleId = input.patch.roleId !== undefined ? input.patch.roleId : nextRole !== 'member' && user.roleId ? null : undefined;
    assertCustomRole(ctx, nextRole, roleId);
    // The plain fields never hold roleId. A plain save sends roleId null, so roleId counts only when it changes.
    const { roleId: _patchRoleId, ...fields } = input.patch;
    const changes = { ...fields, ...(roleId !== undefined && roleId !== (user.roleId ?? null) ? { roleId } : {}) };
    applyPatch(ctx, user, changes, { projectId: null, verb: 'user.updated', targetType: 'user', targetId: user.id });
    return user;
  },
});

export const usersDeactivate = defineCall({
  input: z.object({ id: UserId }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'people.manage');
    const user = requireUser(ctx, input.id);
    assertMayTouch(ctx, user, undefined);
    if (user.id === ctx.authority.id) throw invalid('id', 'You cannot turn off your own account.');
    applyPatch(ctx, user, { active: false }, { projectId: null, verb: 'user.deactivated', targetType: 'user', targetId: user.id });
    return user;
  },
});

/**
 * Turns a deactivated person on again, with their account and history, under the same rules as Deactivate. Without it a
 * person deactivated by mistake stays locked out, because the email check still counts them (audit 2026-10-03, SHL-7).
 */
export const usersReactivate = defineCall({
  input: z.object({ id: UserId }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'people.manage');
    const user = requireUser(ctx, input.id);
    assertNotRemoved(user);
    assertMayTouch(ctx, user, undefined);
    const owner = user.ownerId ? ctx.state.users[user.ownerId] : undefined;
    if (user.kind === 'agent' && !owner?.active) throw invalid('id', 'An agent needs an active person to act for.');
    applyPatch(ctx, user, { active: true }, { projectId: null, verb: 'user.reactivated', targetType: 'user', targetId: user.id });
    return user;
  },
});

/** A removed person is not changed or turned on again: the Admin removed them for good (owner, 2026-10-12). */
function assertNotRemoved(user: User): void {
  if (user.removed) throw invalid('id', 'This person was removed from the list.', 'removed');
}

/**
 * Removes a turned-off person from every list for good (owner, 2026-10-12): the people list, the pickers and the team of each
 * project. The record stays, so the History, the tasks, the comments and the messages keep their name, and the email stays reserved.
 * The agents of the person go with them. Only a turned-off person can be removed, never yourself, and Management never removes an
 * Admin or the agent of an Admin (assertMayTouch). Nothing in the screens brings a removed person back. A second call is harmless.
 */
export const usersRemove = defineCall({
  input: z.object({ id: UserId }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'people.manage');
    const user = requireUser(ctx, input.id);
    assertMayTouch(ctx, user, undefined);
    if (user.id === ctx.authority.id) throw invalid('id', 'You cannot remove your own account.');
    if (user.active) throw invalid('id', 'Turn this person off first. Only a turned-off person can be removed.', 'still_active');
    const meta = { projectId: null, verb: 'user.removed', targetType: 'user', targetId: user.id } as const;
    applyPatch(ctx, user, { removed: true }, meta);
    // The agents of a person cannot act without them. They leave the list too, turned off first when they are still on.
    if (user.kind === 'human') {
      for (const agent of Object.values(ctx.state.users)) {
        if (agent.kind !== 'agent' || agent.ownerId !== user.id) continue;
        applyPatch(ctx, agent, { active: false, removed: true }, { ...meta, targetId: agent.id });
      }
    }
    return user;
  },
});

export const meUpdateProfile = defineCall({
  input: z.object({ name: Name.optional(), nameAr: NameArPatch.optional(), discipline: Discipline.optional(), avatarUrl: UserAvatarInput.optional() }),
  output: User,
  run(input, ctx) {
    // The stored record takes the change. A change to the context copy is lost, because the copy holds the office rights.
    const me = ctx.state.users[ctx.actor.id];
    applyPatch(ctx, me, input, { projectId: null, verb: 'user.profile_changed', targetType: 'user', targetId: ctx.actor.id });
    return me;
  },
});

export const meUpdatePreferences = defineCall({
  input: z.object({ language: Language.optional(), theme: Theme.optional(), glass: Glass.optional(), hatchOverlap: z.boolean().optional() }),
  output: User,
  run(input, ctx) {
    const current = ctx.actor.preferences;
    // The email switches and the morning summary stay as they are: this call never names them (review 2026-10-03).
    const next: Preferences = {
      ...current,
      language: input.language ?? current.language,
      theme: input.theme ?? current.theme,
      glass: input.glass ?? current.glass,
      ...(input.hatchOverlap !== undefined && { hatchOverlap: input.hatchOverlap }),
    };
    // The stored record takes the change. A change to the context copy is lost, because the copy holds the office rights.
    const me = ctx.state.users[ctx.actor.id];
    applyPatch(ctx, me, { preferences: next }, { projectId: null, verb: 'user.preferences_changed', targetType: 'user', targetId: ctx.actor.id });
    return me;
  },
});

export const clientsList = defineCall({
  input: Empty,
  output: z.array(Client),
  readOnly: true,
  run(_input, ctx) {
    const label = (client: Client) => client.name || client.nameAr || '';
    return Object.values(ctx.state.clients).sort((a, b) => label(a).localeCompare(label(b)));
  },
});

export const clientsCreate = defineCall({
  input: z.object({
    name: ClientName.default(''), nameAr: ClientName.default(''), contactName: ContactName.default(''), phone: Phone.default(''), email: ClientEmail.default(''),
    /** Optional, so old callers still work. The new client form asks for it (owner, 2026-10-05). */
    initials: ClientInitials.optional(),
  }),
  output: Client,
  run(input, ctx) {
    assertCan(ctx, 'project.create');
    assertClientNamed(input);
    const id = nextId(ctx.state, 'cli');
    const { initials, ...rest } = input;
    const client: Client = { id, ...rest, ...(initials ? { initials } : {}) };
    ctx.state.clients[id] = client;
    recordCreate(ctx, { projectId: null, verb: 'client.created', targetType: 'client', targetId: id, entity: client });
    return client;
  },
});

export const clientsUpdate = defineCall({
  input: z.object({
    id: ClientId,
    patch: z.object({
      name: ClientName.optional(), nameAr: ClientName.optional(), contactName: ContactName.optional(), phone: Phone.optional(), email: ClientEmail.optional(),
      /** A change only: initials once given stay, because project codes name them. */
      initials: ClientInitials.optional(),
    }),
  }),
  output: Client,
  run(input, ctx) {
    // A client change needs the client right (fbk_014). The Admin holds it. The office can give it to a role.
    assertCan(ctx, 'clients.manage');
    const client = ctx.state.clients[input.id];
    if (!client) throw notFound('Client', input.id);
    assertClientNamed({ ...client, ...input.patch });
    applyPatch(ctx, client, input.patch, { projectId: null, verb: 'client.updated', targetType: 'client', targetId: client.id });
    return client;
  },
});

export const settingsGet = defineCall({
  input: Empty,
  output: Settings,
  readOnly: true,
  run(_input, ctx) {
    return ctx.state.settings;
  },
});

export const settingsUpdate = defineCall({
  input: z.object({
    defaultStages: Settings.shape.defaultStages.optional(),
    codePrefix: Settings.shape.codePrefix.optional(),
    workloadLimit: Settings.shape.workloadLimit.optional(),
    staleAfterDays: Settings.shape.staleAfterDays,
  }),
  output: Settings,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    applyPatch(ctx, ctx.state.settings, input, { projectId: null, verb: 'settings.updated', targetType: 'settings', targetId: 'settings' });
    return ctx.state.settings;
  },
});

export const peopleCalls = {
  'session.get': sessionGet,
  'session.previewAs': sessionPreviewAs,
  'session.setSimulateErrors': sessionSetSimulateErrors,
  'users.list': usersList,
  'users.get': usersGet,
  'users.create': usersCreate,
  'users.update': usersUpdate,
  'users.deactivate': usersDeactivate,
  'users.reactivate': usersReactivate,
  'users.remove': usersRemove,
  'me.updateProfile': meUpdateProfile,
  'me.updatePreferences': meUpdatePreferences,
  'clients.list': clientsList,
  'clients.create': clientsCreate,
  'clients.update': clientsUpdate,
  'settings.get': settingsGet,
  'settings.update': settingsUpdate,
};
