import { defaultPreferences, type Project, type Stage, type Task, type User } from '../api/contract/entities';
import { emptyState, memberKey, type State } from '../api/store';
import { createApi, type Api, type CallMap } from '../api/client';
import { Store } from '../api/store';
import { memoryPersister } from '../api/persist';

export const TODAY = '2026-09-30';
export const NOW = new Date('2026-09-30T06:00:00Z');
export const STAMP = '2026-09-30T09:00:00.000+03:00';

export function makeUser(id: string, overrides: Partial<User> = {}): User {
  return {
    id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member',
    discipline: 'Architect', active: true, ownerId: null, preferences: defaultPreferences(), ...overrides,
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'prj_001', code: 'KH-26-001', name: 'Test Tower', clientId: null, status: 'active', leaderId: 'usr_002',
    currentStageId: 'stg_002', location: 'Al Khobar', areaM2: 1000, startDate: '2026-08-01', targetEndDate: '2027-06-30',
    coverFileId: null, modelFolderPath: '', description: '', healthOverride: null, createdBy: 'usr_001',
    createdAt: STAMP, updatedAt: STAMP, ...overrides,
  };
}

export function makeStage(overrides: Partial<Stage> = {}): Stage {
  return { id: 'stg_001', projectId: 'prj_001', name: 'Concept', order: 0, startDate: null, endDate: null, ...overrides };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_001', projectId: 'prj_001', stageId: 'stg_002', title: 'Ground floor plan', description: '', ownerId: 'usr_003',
    status: 'todo', dueDate: null, flagged: false, needsReview: true, checklist: [], createdBy: 'usr_002',
    createdAt: STAMP, completedAt: null, ...overrides,
  };
}

/** A small office: an Admin, a leader, a team member, an outsider and an agent, with one project. */
export function makeWorld(): State {
  const state = emptyState(TODAY);
  const users = [
    makeUser('usr_001', { name: 'Hala Admin', systemRole: 'admin' }),
    makeUser('usr_002', { name: 'Faisal Leader' }),
    makeUser('usr_003', { name: 'Sara Team' }),
    makeUser('usr_004', { name: 'Omar Other' }),
    makeUser('usr_005', { name: 'Madar Assistant', kind: 'agent', discipline: 'Agent', ownerId: 'usr_003' }),
  ];
  for (const user of users) state.users[user.id] = user;
  state.projects.prj_001 = makeProject();
  state.stages.stg_001 = makeStage({ startDate: '2026-08-01', endDate: '2026-08-31' });
  state.stages.stg_002 = makeStage({ id: 'stg_002', name: 'Schematic Design', order: 1, startDate: '2026-09-01', endDate: '2026-10-31' });
  for (const [userId, discipline] of [['usr_002', 'Architect'], ['usr_003', 'Architect']]) {
    state.members[memberKey('prj_001', userId)] = { projectId: 'prj_001', userId, discipline };
  }
  state.session.currentUserId = 'usr_001';
  state.counters = { usr: 5, prj: 1, stg: 2 };
  return state;
}

export type TestApi<M extends CallMap> = { store: Store; api: Api<M>; as(userId: string): void };
type TestApiFactory = (calls: CallMap, state: State) => TestApi<CallMap>;

let dbTestApi: TestApiFactory | undefined;

/**
 * Db mode (plan 7.2, TM 3.3): the db setup file (server/test/db.ts) registers the mirror store here, so src never imports server
 * code. testApi uses it only when MADAR_DB=1.
 */
export function useDbTestApi(factory: TestApiFactory | undefined): void {
  dbTestApi = factory;
}

/** An API over a test world with no latency. "as" changes the current user. With MADAR_DB=1, the same API on the local database. */
export function testApi<M extends CallMap>(calls: M, state: State = makeWorld()): TestApi<M> {
  if (dbTestApi && process.env.MADAR_DB === '1') return dbTestApi(calls, state) as unknown as TestApi<M>;
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  return {
    store,
    api,
    as(userId: string): void {
      store.state.session.currentUserId = userId;
    },
  };
}
