import { addProjectConversation } from '../api/chatState';
import { STATE_VERSION, type State } from '../api/store';
import { pickMark } from '../lib/projectMark';
import { recordTrackerHistory, SAMPLE_GENDERS } from './seed';

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
  if (state.version === 4) {
    // Version 5: every project gets its own picture (owner, 2026-10-01). The oldest project chooses first.
    const projects = Object.values(state.projects).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const done: { id: string; mark: number }[] = [];
    for (const project of projects) {
      project.mark ??= pickMark(project.id, done);
      done.push({ id: project.id, mark: project.mark });
    }
    state.version = 5;
  }
  if (state.version === 5) {
    // Version 6: the side follows the type. A meeting has both sides, a Balady update comes from a third party (owner, 2026-10-02).
    // An entry with no event in the log gets one, so the Tracker export lists it.
    const logged = new Set(Object.values(state.events).filter((e) => e.verb === 'tracker.logged').map((e) => e.targetId));
    for (const entry of Object.values(state.tracker ?? {})) {
      if (entry.type === 'meeting') entry.direction = 'both';
      if (entry.type === 'balady') entry.direction = 'third_party';
      if (!logged.has(entry.id) && state.users[entry.createdBy]) recordTrackerHistory(state, entry);
    }
    state.version = 6;
  }
  if (state.version === 6) {
    // Version 7: a paused project tells its leader on the restart day (audit 2026-10-03, API-18). Every person gets the notice, turned on.
    for (const user of Object.values(state.users)) user.preferences.notifications.resume_due ??= true;
    state.version = 7;
  }
  return state.version === STATE_VERSION ? state : null;
}
