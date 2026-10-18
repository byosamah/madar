import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { CustomRole, OfficeRight, RoleId, RoleSettings, type Event } from '../contract/entities';
import { ApiError, invalid } from '../errors';
import { recordCreate, recordDelete, writeEvent } from '../events';
import { DEFAULT_RIGHTS, OFFICE_RIGHTS } from '../permissions';
import { nextId, type State } from '../store';
import { assertCan } from './shared';

/**
 * The office roles (owner, 2026-10-18, fbk_014). Only the Admin makes or changes a role (admin.manage). The roles live in the office
 * settings (Settings.roles), so no table holds them. Each change writes one settings event, and an Undo takes it back
 * (undoRoleChange, called from handlers/history.ts).
 */

const BUILT_IN = ['management', 'accounting', 'member'] as const;
type BuiltIn = (typeof BUILT_IN)[number];

/** The most custom roles that one office holds. */
const MAX_CUSTOM = 20;

const RoleName = z.string().trim().min(1).max(40);
const Rights = z.array(OfficeRight).max(20);
const ROLE_VERBS: ReadonlySet<string> = new Set(['role.created', 'role.updated', 'role.deleted']);

const isBuiltIn = (role: string): role is BuiltIn => (BUILT_IN as readonly string[]).includes(role);
/** The rights in the order of the rights list, each one once. */
const inOrder = (rights: readonly string[]): OfficeRight[] => OFFICE_RIGHTS.filter((right) => rights.includes(right));
const sameRights = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((right, index) => right === b[index]);
const conflict = (message = 'This item changed after that edit. Undo is not available.') => new ApiError('conflict', message);

/** The office roles. An office saved before roles has none, so the first change makes the record. */
function rolesOf(state: State): RoleSettings {
  state.settings.roles ??= {};
  return state.settings.roles;
}

/** The field of the first other custom role that has the name: English in any case, Arabic as written. Null when no role has it. */
function nameTaken(custom: readonly CustomRole[], name: string, nameAr: string, exceptId: string): 'name' | 'nameAr' | null {
  for (const role of custom) {
    if (role.id === exceptId) continue;
    if (role.name.toLowerCase() === name.toLowerCase()) return 'name';
    if (role.nameAr === nameAr) return 'nameAr';
  }
  return null;
}

function assertNamesFree(custom: readonly CustomRole[], name: string, nameAr: string, exceptId: string): void {
  const field = nameTaken(custom, name, nameAr, exceptId);
  if (field) throw invalid(field, 'Another role has this name. Use another name.', 'role_name_taken');
}

export const rolesCreate = defineCall({
  input: z.object({ name: RoleName, nameAr: RoleName, rights: Rights }),
  output: CustomRole,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const roles = rolesOf(ctx.state);
    const custom = roles.custom ?? [];
    if (custom.length >= MAX_CUSTOM) throw invalid('name', 'The office has the most roles it can hold. Delete a role first.', 'role_limit');
    assertNamesFree(custom, input.name, input.nameAr, '');
    const role: CustomRole = { id: nextId(ctx.state, 'rol'), name: input.name, nameAr: input.nameAr, rights: inOrder(input.rights) };
    roles.custom = [...custom, role];
    recordCreate(ctx, { projectId: null, verb: 'role.created', targetType: 'settings', targetId: role.id, entity: role });
    return role;
  },
});

/** A built-in role takes new rights. It has no name, so a name in the change refuses. No change writes no event. */
function changeBuiltIn(ctx: Ctx, roles: RoleSettings, role: BuiltIn, rights: readonly OfficeRight[]): void {
  const before = [...(roles.rights?.[role] ?? DEFAULT_RIGHTS[role])];
  if (sameRights(before, rights)) return;
  const next = { ...roles.rights };
  next[role] = [...rights];
  roles.rights = next;
  writeEvent(ctx, { projectId: null, verb: 'role.updated', targetType: 'settings', targetId: role, before: { rights: before }, after: { rights: [...rights] } });
}

/** A custom role takes a new name, new names or new rights. Only the fields that change are written, in one event. */
function changeCustom(ctx: Ctx, roles: RoleSettings, id: string, patch: { name?: string; nameAr?: string; rights?: OfficeRight[] }): void {
  const custom = roles.custom ?? [];
  const role = custom.find((item) => item.id === id);
  if (!role) throw invalid('role', 'This role does not exist.', 'role_missing');
  if (patch.name !== undefined || patch.nameAr !== undefined) assertNamesFree(custom, patch.name ?? role.name, patch.nameAr ?? role.nameAr, role.id);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of ['name', 'nameAr', 'rights'] as const) {
    const next = patch[key];
    if (next === undefined || JSON.stringify(role[key]) === JSON.stringify(next)) continue;
    before[key] = structuredClone(role[key]);
    after[key] = structuredClone(next);
    (role as unknown as Record<string, unknown>)[key] = structuredClone(next);
  }
  if (Object.keys(after).length > 0) writeEvent(ctx, { projectId: null, verb: 'role.updated', targetType: 'settings', targetId: role.id, before, after });
}

export const rolesUpdate = defineCall({
  input: z.object({
    role: z.union([z.enum(BUILT_IN), RoleId]),
    name: RoleName.optional(),
    nameAr: RoleName.optional(),
    rights: Rights.optional(),
  }),
  output: RoleSettings,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const roles = rolesOf(ctx.state);
    const rights = input.rights ? inOrder(input.rights) : undefined;
    if (isBuiltIn(input.role)) {
      if (input.name !== undefined || input.nameAr !== undefined) throw invalid('name', 'A built-in role has no name to change.', 'built_in_name');
      if (rights) changeBuiltIn(ctx, roles, input.role, rights);
    } else {
      changeCustom(ctx, roles, input.role, { name: input.name, nameAr: input.nameAr, rights });
    }
    return roles;
  },
});

export const rolesDelete = defineCall({
  input: z.object({ id: RoleId }),
  output: z.object({}),
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const roles = rolesOf(ctx.state);
    const custom = roles.custom ?? [];
    const role = custom.find((item) => item.id === input.id);
    if (!role) throw invalid('id', 'This role does not exist.', 'role_missing');
    // A person keeps the role until the Admin moves them, so the role stays while anyone holds it.
    const holders = Object.values(ctx.state.users).filter((user) => user.roleId === role.id).length;
    if (holders > 0) {
      throw new ApiError('invalid_input', 'People hold this role. Move them to another role first.', { fields: ['id'], reason: 'role_in_use', count: holders });
    }
    roles.custom = custom.filter((item) => item.id !== role.id);
    recordDelete(ctx, { projectId: null, verb: 'role.deleted', targetType: 'settings', targetId: role.id, entity: role });
    return {};
  },
});

/** True for an event that a role call wrote. handlers/history.ts takes these back with undoRoleChange. */
export function isRoleEvent(event: Event): boolean {
  return event.targetType === 'settings' && ROLE_VERBS.has(event.verb);
}

/**
 * Takes one role change back, under the rules of events.ts: a later change of the same role that stands blocks the Undo, and a
 * value that names another role (a name in use, a role that a person holds) blocks it too.
 */
export function undoRoleChange(ctx: Ctx, event: Event): Event {
  if (event.undoneBy) throw conflict('This change is already undone.');
  const roles = rolesOf(ctx.state);
  const custom = roles.custom ?? [];
  const later = Object.values(ctx.state.events).filter(
    (e) => e.seq > event.seq && e.targetType === 'settings' && e.targetId === event.targetId && e.undoneBy === null && e.verb !== 'undo',
  );
  const meta = { projectId: null, verb: 'undo', targetType: 'settings' as const, targetId: event.targetId, undoes: event.id };
  let undo: Event;
  if (event.verb === 'role.created') {
    const role = custom.find((item) => item.id === event.targetId);
    if (!role || later.length > 0) throw conflict();
    if (Object.values(ctx.state.users).some((user) => user.roleId === role.id)) throw conflict('Other items now use this. Undo is not available.');
    roles.custom = custom.filter((item) => item.id !== role.id);
    undo = writeEvent(ctx, { ...meta, before: structuredClone(role), after: null });
  } else if (event.verb === 'role.deleted') {
    const restore = structuredClone(event.before) as CustomRole;
    if (later.length > 0 || custom.some((item) => item.id === restore.id) || nameTaken(custom, restore.name, restore.nameAr, '')) throw conflict();
    roles.custom = [...custom, restore];
    undo = writeEvent(ctx, { ...meta, before: null, after: structuredClone(restore) });
  } else {
    const restore = event.before as Record<string, unknown>;
    const keys = Object.keys(event.after as Record<string, unknown>);
    const clash = later.some((e) => e.after === null || Object.keys((e.after ?? {}) as object).some((key) => keys.includes(key)));
    if (clash) throw conflict();
    if (isBuiltIn(event.targetId)) {
      const current = [...(roles.rights?.[event.targetId] ?? DEFAULT_RIGHTS[event.targetId])];
      const rights = [...(restore.rights as OfficeRight[])];
      const next = { ...roles.rights };
      next[event.targetId] = rights;
      roles.rights = next;
      undo = writeEvent(ctx, { ...meta, before: { rights: current }, after: { rights: [...rights] } });
    } else {
      const role = custom.find((item) => item.id === event.targetId);
      if (!role) throw conflict();
      const names = restore as { name?: string; nameAr?: string };
      if (nameTaken(custom, names.name ?? role.name, names.nameAr ?? role.nameAr, role.id)) throw conflict();
      const before: Record<string, unknown> = {};
      for (const key of Object.keys(restore)) {
        before[key] = structuredClone((role as unknown as Record<string, unknown>)[key]);
        (role as unknown as Record<string, unknown>)[key] = structuredClone(restore[key]);
      }
      undo = writeEvent(ctx, { ...meta, before, after: structuredClone(restore) });
    }
  }
  event.undoneBy = undo.id;
  return undo;
}

export const rolesCalls = {
  'roles.create': rolesCreate,
  'roles.update': rolesUpdate,
  'roles.delete': rolesDelete,
};
