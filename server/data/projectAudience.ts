import { can, holdsRight, projectResource, type Actor } from '../../src/api/permissions';
import { LOCKED_RIGHT } from '../../src/api/folderLock';
import { withOfficeRights } from '../../src/api/rights';
import type { State } from '../../src/api/store';

/**
 * Who hears the changes of a project (hidden projects, owner 2026-10-22, wave D3). The one rule is the view rule of a project
 * (`can(.., 'project.view', ..)` with `projectResource`, src/api/permissions.ts), asked for each active person of a State.
 *
 * A project is "open to all" when every active person may view it. Its changes go on the office signal, as before. A project that at
 * least one active person may not view (hidden, or open for a role without "See every project") is "restricted". Its changes go
 * only as person signals to the people who may view it before the change or after it. So a person who loses the view hears the
 * change, and a person who gains the view hears it too.
 *
 * With the default settings (every role holds "See every project", no project hidden) no project is restricted, and nothing here
 * changes a signal.
 */

/** The people who may view a project in one State: null when every active person may. A project that the State lacks has no viewers. */
export type Viewers = ReadonlySet<string> | null;

type Finder = {
  /** The active people of the State: the people who hear signals. */
  humans: () => readonly string[];
  /** The viewers of a project in the State: null when every active person views it; an empty set when the State lacks the project. */
  of: (projectId: string) => Viewers;
};

/** The finder of one State. It builds the rights of each active person once, and only when a project asks. */
function finderOf(state: State): Finder {
  let actors: Actor[] | undefined;
  let allSeeAll: boolean | undefined;
  const actorsOf = (): Actor[] => {
    actors ??= Object.values(state.users)
      .filter((user) => user.kind === 'human' && user.active)
      .map((user) => withOfficeRights(user, state.settings?.roles));
    return actors;
  };
  const everyoneSeesAll = (): boolean => {
    allSeeAll ??= actorsOf().every((actor) => actor.systemRole === 'admin' || (actor.officeRights ?? []).includes('project.seeAll'));
    return allSeeAll;
  };
  return {
    humans: () => actorsOf().map((actor) => actor.id),
    of(projectId) {
      const project = state.projects[projectId];
      if (!project) return new Set();
      // The quick road: an open project and a role set where everyone holds "See every project".
      if (project.access?.hidden !== true && everyoneSeesAll()) return null;
      const found = actorsOf().filter((actor) => can(actor, 'project.view', projectResource(state, projectId, actor.id)));
      return found.length === actorsOf().length ? null : new Set(found.map((actor) => actor.id));
    },
  };
}

/**
 * The people who hear a change of a project, or null when the project is open to all in both States (the change is public). Both
 * States count: the people who see the project before the change or after it. A project that neither State holds is public (null).
 */
export function audienceFinder(before: State, after: State): (projectId: string) => ReadonlySet<string> | null {
  const was = finderOf(before);
  const now = finderOf(after);
  const memo = new Map<string, ReadonlySet<string> | null>();
  return (projectId) => {
    if (memo.has(projectId)) return memo.get(projectId)!;
    const gone = (state: State) => state.projects[projectId] === undefined;
    const old = was.of(projectId);
    const next = now.of(projectId);
    let audience: ReadonlySet<string> | null = null;
    // A side that is null (everyone views) or empty (the State lacks the project) adds nothing restricted by itself.
    const restricted = (viewers: Viewers, state: State) => viewers !== null && !gone(state);
    if (restricted(old, before) || restricted(next, after)) {
      audience = new Set([
        ...(old === null ? (gone(before) ? [] : was.humans()) : old),
        ...(next === null ? (gone(after) ? [] : now.humans()) : next),
      ]);
    }
    memo.set(projectId, audience);
    return audience;
  };
}

/**
 * The people who hear a change that touches a locked folder (fbk_074): the people who view the project and hold the switch "Locked folders", in the
 * State before the change or after it. The Admin holds the switch. Everyone else hears nothing of a locked folder, not even that something changed.
 */
export function lockedAudienceFinder(before: State, after: State): (projectId: string) => ReadonlySet<string> {
  const viewersOf = audienceFinder(before, after);
  const holders = new Set<string>();
  for (const state of [before, after]) {
    for (const user of Object.values(state.users)) {
      if (user.kind === 'human' && user.active && holdsRight(withOfficeRights(user, state.settings?.roles), LOCKED_RIGHT)) holders.add(user.id);
    }
  }
  return (projectId) => {
    const viewers = viewersOf(projectId);
    return new Set([...holders].filter((id) => viewers === null || viewers.has(id)));
  };
}
