import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import {
  Gender,
  Client, ClientId, Glass, Language, Settings, Theme, User, UserId, defaultPreferences, type Preferences,
} from '../contract/entities';
import { UserCard } from '../contract/views';
import { invalid, notFound } from '../errors';
import { applyPatch, recordCreate } from '../events';
import { nextId } from '../store';
import { userCard } from '../views';
import { assertCan, byName, requireUser } from './shared';

const Empty = z.object({});
const Name = z.string().trim().min(1).max(80);
const Discipline = z.string().trim().min(1).max(40);
const SystemRole = z.enum(['admin', 'member']);
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
  hint: z.enum(['admin', 'leader', 'member', 'agent']),
  actingForName: z.string().nullable(),
});

export const sessionGet = defineCall({
  input: Empty,
  output: z.object({
    user: User, authority: User, actingFor: UserCard.nullable(), previewUsers: z.array(PreviewUser), persistent: z.boolean(), simulateErrors: z.boolean(),
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
        hint: u.kind === 'agent' ? ('agent' as const) : u.systemRole === 'admin' ? ('admin' as const) : leaders.has(u.id) ? ('leader' as const) : ('member' as const),
      }));
    const actingFor = ctx.actor.kind === 'agent' ? userCard(ctx.authority) : null;
    // "authority" is the person whose rights and notification choices apply: the user, or the person an agent acts for.
    return { user: ctx.actor, authority: ctx.authority, actingFor, previewUsers, persistent: ctx.persistent, simulateErrors: ctx.state.session.simulateErrors };
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
    return Object.values(ctx.state.users).filter((u) => input.includeInactive || u.active).sort(byName);
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

export const usersCreate = defineCall({
  input: z.object({
    name: Name,
    email: z.email(),
    systemRole: SystemRole.default('member'),
    kind: Kind.default('human'),
    discipline: Discipline,
    ownerId: UserId.optional(),
    gender: Gender.optional(),
  }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    assertEmailFree(ctx, input.email, null);
    if (input.kind === 'agent' && input.systemRole === 'admin') throw agentAdmin();
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
      id, name: input.name, email: input.email, systemRole: input.systemRole, kind: input.kind, discipline: input.discipline,
      ownerId, avatarUrl: null, active: true, preferences: defaultPreferences(), gender: input.gender,
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
      email: z.email().optional(),
      systemRole: SystemRole.optional(),
      discipline: Discipline.optional(),
      avatarUrl: z.string().max(2000).nullable().optional(),
      gender: Gender.optional(),
    }).strict(), // A person never becomes an agent, or back: that would break the owner rule of spec 17.
  }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const user = requireUser(ctx, input.id);
    if (input.patch.email) assertEmailFree(ctx, input.patch.email, user.id);
    if (input.patch.systemRole === 'admin' && user.kind === 'agent') throw agentAdmin();
    if (input.patch.systemRole === 'member' && user.systemRole === 'admin') {
      // Only people count: an agent acts with its person's rights, so an agent can never keep the office's Admin work going.
      const admins = Object.values(ctx.state.users).filter((u) => u.kind === 'human' && u.systemRole === 'admin' && u.active);
      if (admins.length <= 1) throw invalid('systemRole', 'The office needs at least one Admin.', 'last_admin');
    }
    applyPatch(ctx, user, input.patch, { projectId: null, verb: 'user.updated', targetType: 'user', targetId: user.id });
    return user;
  },
});

export const usersDeactivate = defineCall({
  input: z.object({ id: UserId }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const user = requireUser(ctx, input.id);
    if (user.id === ctx.authority.id) throw invalid('id', 'You cannot turn off your own account.');
    applyPatch(ctx, user, { active: false }, { projectId: null, verb: 'user.deactivated', targetType: 'user', targetId: user.id });
    return user;
  },
});

export const meUpdateProfile = defineCall({
  input: z.object({ name: Name.optional(), discipline: Discipline.optional(), avatarUrl: z.string().max(2000).nullable().optional() }),
  output: User,
  run(input, ctx) {
    applyPatch(ctx, ctx.actor, input, { projectId: null, verb: 'user.profile_changed', targetType: 'user', targetId: ctx.actor.id });
    return ctx.actor;
  },
});

export const meUpdatePreferences = defineCall({
  input: z.object({ language: Language.optional(), theme: Theme.optional(), glass: Glass.optional() }),
  output: User,
  run(input, ctx) {
    const current = ctx.actor.preferences;
    const next: Preferences = {
      language: input.language ?? current.language,
      theme: input.theme ?? current.theme,
      glass: input.glass ?? current.glass,
      notifications: current.notifications,
    };
    applyPatch(ctx, ctx.actor, { preferences: next }, { projectId: null, verb: 'user.preferences_changed', targetType: 'user', targetId: ctx.actor.id });
    return ctx.actor;
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
  input: z.object({ name: ClientName.default(''), nameAr: ClientName.default(''), contactName: ContactName.default(''), phone: Phone.default(''), email: ClientEmail.default('') }),
  output: Client,
  run(input, ctx) {
    assertCan(ctx, 'project.create');
    assertClientNamed(input);
    const id = nextId(ctx.state, 'cli');
    const client: Client = { id, ...input };
    ctx.state.clients[id] = client;
    recordCreate(ctx, { projectId: null, verb: 'client.created', targetType: 'client', targetId: id, entity: client });
    return client;
  },
});

export const clientsUpdate = defineCall({
  input: z.object({
    id: ClientId,
    patch: z.object({ name: ClientName.optional(), nameAr: ClientName.optional(), contactName: ContactName.optional(), phone: Phone.optional(), email: ClientEmail.optional() }),
  }),
  output: Client,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
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
  'me.updateProfile': meUpdateProfile,
  'me.updatePreferences': meUpdatePreferences,
  'clients.list': clientsList,
  'clients.create': clientsCreate,
  'clients.update': clientsUpdate,
  'settings.get': settingsGet,
  'settings.update': settingsUpdate,
};
