import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { CustomRole, MAX_OFF_RIGHTS, MAX_STORED_RIGHTS, OfficeRight, RoleId, RoleSettings, StoredRight, type Event } from '../contract/entities';
import { ApiError, invalid } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { BASIC_ON, DEFAULT_EXTRA, expandRights } from '../rightsCatalog';
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
/** The rights of a save: the 119 ids, and the old ids of 2026-10-23 (they expand to new ids when the role is saved). */
const Rights = z.array(StoredRight).max(MAX_STORED_RIGHTS);
/** The basic switches that the role does not hold (role rights version 2). */
const Off = z.array(OfficeRight).max(MAX_OFF_RIGHTS);
const ROLE_VERBS: ReadonlySet<string> = new Set(['role.created', 'role.updated', 'role.deleted']);

const isBuiltIn = (role: string): role is BuiltIn => (BUILT_IN as readonly string[]).includes(role);
/**
 * The rights of a save, as the store holds them: the new ids only (an old id expands to the switches it stands for), each one once, in
 * the order of the catalog, and without the basic switches. A basic switch is on by default, so only `off` can change it.
 */
const inOrder = (rights: readonly string[]): OfficeRight[] => expandRights(rights).filter((right) => !BASIC_ON.includes(right));
/** The turned-off basic switches of a save: only basic ids, each one once, in the order of the catalog. */
const offInOrder = (off: readonly string[]): OfficeRight[] => BASIC_ON.filter((right) => off.includes(right));
/**
 * True when both lists mean the same switches, in any order and in any form: an old id and the new ids it stands for are the same
 * (role rights version 2). A save that changes nothing writes no event.
 */
const sameRights = (a: readonly string[], b: readonly string[]): boolean => {
  const left = expandRights(a);
  const right = expandRights(b);
  return left.length === right.length && left.every((id) => right.includes(id));
};
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
  input: z.object({ name: RoleName, nameAr: RoleName, rights: Rights, off: Off.optional() }),
  output: CustomRole,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const roles = rolesOf(ctx.state);
    const custom = roles.custom ?? [];
    if (custom.length >= MAX_CUSTOM) throw invalid('name', 'The office has the most roles it can hold. Delete a role first.', 'role_limit');
    assertNamesFree(custom, input.name, input.nameAr, '');
    // A role made with `off` holds its own full list. A role made without it (the sheet of before role rights version 2) holds the Member
    // switches and its own.
    const role: CustomRole = {
      id: nextId(ctx.state, 'rol'), name: input.name, nameAr: input.nameAr, rights: inOrder(input.rights),
      ...(input.off !== undefined ? { off: offInOrder(input.off) } : {}),
    };
    roles.custom = [...custom, role];
    recordCreate(ctx, { projectId: null, verb: 'role.created', targetType: 'settings', targetId: role.id, entity: role });
    return role;
  },
});

/**
 * A built-in role takes new rights or new turned-off basics. It has no name, so a name in the change refuses. No change writes no event.
 * The event keeps the old and the new value of each field that changed (rights, off).
 */
function changeBuiltIn(ctx: Ctx, roles: RoleSettings, role: BuiltIn, patch: { rights?: OfficeRight[]; off?: OfficeRight[] }): void {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (patch.rights !== undefined) {
    const was = [...(roles.rights?.[role] ?? DEFAULT_EXTRA[role])];
    if (!sameRights(was, patch.rights)) {
      before.rights = was;
      after.rights = [...patch.rights];
      roles.rights = { ...roles.rights, [role]: [...patch.rights] };
    }
  }
  if (patch.off !== undefined) {
    const was = [...(roles.off?.[role] ?? [])];
    if (!sameRights(was, patch.off)) {
      before.off = was;
      after.off = [...patch.off];
      roles.off = { ...roles.off, [role]: [...patch.off] };
    }
  }
  if (Object.keys(after).length > 0) writeEvent(ctx, { projectId: null, verb: 'role.updated', targetType: 'settings', targetId: role, before, after });
}

/** A custom role takes a new name, new names, new rights or new turned-off basics. Only the fields that change are written, in one event. */
function changeCustom(ctx: Ctx, roles: RoleSettings, id: string, patch: { name?: string; nameAr?: string; rights?: OfficeRight[]; off?: OfficeRight[] }): void {
  const custom = roles.custom ?? [];
  const role = custom.find((item) => item.id === id);
  if (!role) throw invalid('role', 'This role does not exist.', 'role_missing');
  if (patch.name !== undefined || patch.nameAr !== undefined) assertNamesFree(custom, patch.name ?? role.name, patch.nameAr ?? role.nameAr, role.id);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of ['name', 'nameAr', 'rights', 'off'] as const) {
    const next = patch[key];
    if (next === undefined) continue;
    // A role without `off` keeps its old meaning. A first `off` changes the meaning, so it is always a change.
    const same = key === 'rights' ? sameRights(role.rights, next as OfficeRight[])
      : key === 'off' ? role.off !== undefined && sameRights(role.off, next as OfficeRight[])
        : JSON.stringify(role[key]) === JSON.stringify(next);
    if (same) continue;
    // `null` in the old side says "the role had no `off`": the Undo takes the field away again.
    before[key] = key === 'off' ? (role.off === undefined ? null : structuredClone(role.off)) : structuredClone(role[key]);
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
    /** The basic switches that the role does not hold. A built-in role with no `off` keeps the one it has. */
    off: Off.optional(),
  }),
  output: RoleSettings,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const roles = rolesOf(ctx.state);
    const rights = input.rights ? inOrder(input.rights) : undefined;
    const off = input.off ? offInOrder(input.off) : undefined;
    if (isBuiltIn(input.role)) {
      if (input.name !== undefined || input.nameAr !== undefined) throw invalid('name', 'A built-in role has no name to change.', 'built_in_name');
      changeBuiltIn(ctx, roles, input.role, { rights, off });
    } else {
      changeCustom(ctx, roles, input.role, { name: input.name, nameAr: input.nameAr, rights, off });
    }
    return roles;
  },
});

export const rolesDelete = defineCall({
  input: z.object({
    id: RoleId,
    /**
     * The role that the people of the deleted role take (ADM-14): a built-in role (not Admin) or another custom role. Without it, a role
     * that people hold is refused. With it, the people move first and the role goes, all in one story, so one Undo brings both back.
     */
    moveTo: z.union([z.enum(BUILT_IN), RoleId]).optional(),
  }),
  output: z.object({}),
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const roles = rolesOf(ctx.state);
    const custom = roles.custom ?? [];
    const role = custom.find((item) => item.id === input.id);
    if (!role) throw invalid('id', 'This role does not exist.', 'role_missing');
    // A person keeps the role until the Admin moves them, so the role stays while anyone holds it. A removed person is in no list
    // and the Admin cannot move them, so the count skips them. A turned-off person still counts: the Admin sees and moves them.
    const holders = Object.values(ctx.state.users).filter((user) => !user.removed && user.roleId === role.id);
    if (holders.length > 0) {
      if (input.moveTo === undefined) {
        throw new ApiError('invalid_input', 'People hold this role. Move them to another role first.', { fields: ['id'], reason: 'role_in_use', count: holders.length });
      }
      if (input.moveTo === role.id || (!isBuiltIn(input.moveTo) && !custom.some((item) => item.id === input.moveTo))) {
        throw invalid('moveTo', 'Choose another role that the office has.', 'role_missing');
      }
      const next = isBuiltIn(input.moveTo) ? { systemRole: input.moveTo, roleId: null } : { systemRole: 'member' as const, roleId: input.moveTo };
      for (const user of holders) {
        applyPatch(ctx, user, next, { projectId: null, verb: 'user.updated', targetType: 'user', targetId: user.id });
      }
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
 * Takes one role change back, under the rules of events.ts. A later change of the same role that stands blocks the Undo. A
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
    if (Object.values(ctx.state.users).some((user) => !user.removed && user.roleId === role.id)) throw conflict('Other items now use this. Undo is not available.');
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
    // An old event may hold old ids (project.editAny and so on): the Undo writes the new ids they stand for.
    if (isBuiltIn(event.targetId)) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if ('rights' in restore) {
        const current = [...(roles.rights?.[event.targetId] ?? DEFAULT_EXTRA[event.targetId])];
        const rights = inOrder(restore.rights as string[]);
        roles.rights = { ...roles.rights, [event.targetId]: rights };
        before.rights = current;
        after.rights = [...rights];
      }
      if ('off' in restore) {
        const current = [...(roles.off?.[event.targetId] ?? [])];
        const off = offInOrder((restore.off ?? []) as string[]);
        roles.off = { ...roles.off, [event.targetId]: off };
        before.off = current;
        after.off = [...off];
      }
      undo = writeEvent(ctx, { ...meta, before, after });
    } else {
      const role = custom.find((item) => item.id === event.targetId);
      if (!role) throw conflict();
      const names = restore as { name?: string; nameAr?: string };
      if (nameTaken(custom, names.name ?? role.name, names.nameAr ?? role.nameAr, role.id)) throw conflict();
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of Object.keys(restore)) {
        const value = key === 'rights' ? inOrder(restore.rights as string[])
          : key === 'off' ? (restore.off === null ? undefined : offInOrder(restore.off as string[]))
            : structuredClone(restore[key]);
        const current = (role as unknown as Record<string, unknown>)[key];
        before[key] = key === 'off' && current === undefined ? null : structuredClone(current);
        after[key] = value === undefined ? null : structuredClone(value);
        if (value === undefined) delete (role as unknown as Record<string, unknown>)[key];
        else (role as unknown as Record<string, unknown>)[key] = value;
      }
      undo = writeEvent(ctx, { ...meta, before, after });
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
