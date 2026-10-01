import { addProjectConversation } from '../api/chatState';
import { STATE_VERSION, type State } from '../api/store';
import { SAMPLE_GENDERS } from './seed';

/** Brings an office saved by an older prototype up to date and keeps the work in it. Null means: build a fresh office. */
export function migrateState(state: State): State | null {
  if (state.version === 1) {
    // Version 2: Arabic verbs agree with a person's gender, so the sample people get theirs.
    for (const user of Object.values(state.users)) {
      const gender = SAMPLE_GENDERS[user.email];
      if (gender && !user.gender) user.gender = gender;
    }
    state.version = 2;
  }
  if (state.version === 2) {
    // Version 3: the office does not track hours (owner, 2026-10-01). The hours data and its notices go.
    const old = state as State & { time?: unknown; timeRows?: unknown; weekUnlocks?: unknown };
    delete old.time;
    delete old.timeRows;
    delete old.weekUnlocks;
    for (const user of Object.values(state.users)) {
      delete (user as typeof user & { weeklyHourTarget?: number }).weeklyHourTarget;
      delete (user.preferences.notifications as Record<string, boolean>).week_under_target;
    }
    for (const [id, notice] of Object.entries(state.notifications)) {
      if ((notice.trigger as string) === 'week_under_target') delete state.notifications[id];
    }
    for (const [id, event] of Object.entries(state.events)) {
      if ((event.targetType as string) === 'time') delete state.events[id];
    }
    state.version = 3;
  }
  if (state.version === 3) {
    // Version 4: the Inbox is a chat. Every project gets its chat room. The collections start empty.
    state.conversations ??= {};
    state.messages ??= {};
    state.chatReads ??= {};
    for (const project of Object.values(state.projects)) {
      const has = Object.values(state.conversations).some((c) => c.kind === 'project' && c.projectId === project.id);
      if (!has) addProjectConversation(state, project.id, project.createdAt);
    }
    state.version = 4;
  }
  return state.version === STATE_VERSION ? state : null;
}
