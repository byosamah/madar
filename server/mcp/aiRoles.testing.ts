import type { CustomRole, OfficeRight, RoleSettings } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { AI_SWITCHES } from './aiSwitches';

/**
 * Helpers for the tests of the AI switches (role rights version 2): a role with some switches turned off, given to one person of the
 * sample office. Only tests import this file.
 */

/** Every AI switch id, with the two scopes of the Undo of other agents. */
export const EVERY_AI_ID: readonly OfficeRight[] = [...AI_SWITCHES, 'ai.undoOthers.lead', 'ai.undoOthers.all'];

/**
 * The ids that a role sheet sends when it turns the ids off: every AI switch needs ai.connect, so turning ai.connect off turns the other
 * AI switches off with it (rightsOf adds the needed ids back, so a stored list cannot keep ai.connect off alone).
 */
export function offWith(...ids: OfficeRight[]): OfficeRight[] {
  return ids.includes('ai.connect') ? [...EVERY_AI_ID] : ids;
}

/** A custom role that holds the Member switches without the ids given, and the extra switches given (old or new ids). */
export function roleWithout(ids: OfficeRight[], rights: CustomRole['rights'] = []): CustomRole {
  return { id: 'rol_001', name: 'Test role', nameAr: 'دور تجريبي', rights, off: offWith(...ids) };
}

/** Gives the person the custom role. It returns what restores the office. */
export function giveRole(state: State, userId: string, role: CustomRole): () => void {
  const person = state.users[userId];
  const before = state.settings.roles;
  state.settings.roles = { ...(before ?? {}), custom: [role] };
  state.users[userId] = { ...person, systemRole: 'member', roleId: role.id };
  return () => {
    state.users[userId] = person;
    if (before === undefined) delete state.settings.roles;
    else state.settings.roles = before;
  };
}

/** Turns switches off for a built-in role. It returns what restores the office. */
export function builtInWithout(state: State, role: 'management' | 'accounting' | 'member', ids: OfficeRight[]): () => void {
  const before = state.settings.roles;
  const next: RoleSettings = { ...(before ?? {}), off: { ...(before?.off ?? {}), [role]: offWith(...ids) } };
  state.settings.roles = next;
  return () => {
    if (before === undefined) delete state.settings.roles;
    else state.settings.roles = before;
  };
}
