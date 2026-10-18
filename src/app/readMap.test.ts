import { beforeAll, describe, expect, it } from 'vitest';
import { calls } from '../api/calls';
import { ApiError } from '../api/errors';
import { executeParsed, resolveAuthority } from '../api/execute';
import type { AnyCall } from '../api/registry';
import { READ_CALLS } from '../api/remote/keys';
import type { Kind } from '../api/remote/wire';
import type { State } from '../api/store';
import { buildSeed } from '../data/seed';
import { NOW, TODAY } from '../test/factories';
import { COLLECTION_KINDS, READS } from './readMap';

/**
 * The read map must name every kind that a read call reads (plan 5.3, client map R-6). This test runs each read call over the
 * sample office, for several inputs and several people, on a State that records what the call touches: each collection, the
 * updatedAt of a project (the kind projectTouched) and the preferences of a person (the kind preferences). The output check
 * counts too, because the screens show what the call returns. It fails when READS misses a kind.
 */

const COLLECTIONS = new Set<string>(COLLECTION_KINDS);

/** A State that records the kinds a call reads. Each object keeps one proxy, so a call that compares records still works. */
function recording(state: State): { state: State; seen: Set<Kind> } {
  const seen = new Set<Kind>();
  const proxies = new WeakMap<object, object>();
  const wrap = <T extends object>(target: T, onGet: (key: string | symbol, value: unknown) => unknown): T => {
    let proxy = proxies.get(target);
    if (!proxy) {
      proxy = new Proxy(target, { get: (t, key, receiver) => onGet(key, Reflect.get(t, key, receiver)) });
      proxies.set(target, proxy);
    }
    return proxy as T;
  };
  const record = (collection: string, rec: object): object => {
    if (collection === 'projects') return wrap(rec, (key, value) => {
      if (key === 'updatedAt') seen.add('projectTouched');
      return value;
    });
    if (collection === 'users') return wrap(rec, (key, value) => {
      if (key === 'preferences') seen.add('preferences');
      return value;
    });
    return rec;
  };
  const top = wrap(state, (key, value) => {
    if (typeof key !== 'string' || !COLLECTIONS.has(key)) return value;
    seen.add(key as Kind);
    if (key === 'settings' || typeof value !== 'object' || value === null) return value;
    return wrap(value, (id, rec) => (typeof id === 'string' && typeof rec === 'object' && rec !== null ? record(key, rec) : rec));
  });
  return { state: top, seen };
}

/** The inputs of each read call, made from the records of the sample office, so each branch of the call runs. */
function inputsOf(name: string, s: State): unknown[] {
  const ids = (map: Record<string, unknown> | undefined, n = 4) => Object.keys(map ?? {}).slice(0, n);
  const projectIds = [...ids(s.projects, 3), ...Object.values(s.projects).filter((p) => p.status !== 'active').map((p) => p.id).slice(0, 2)];
  const taskIds = ids(s.tasks, 6);
  const updateIds = ids(s.updates, 3);
  const userIds = Object.values(s.users).map((u) => u.id);
  const clientIds = ids(s.clients, 2);
  const teamIds = ids(s.teams, 2);
  const conversationIds = Object.keys(s.conversations);
  const someMessage = Object.values(s.messages)[0];
  const someFile = Object.values(s.files)[0];
  const someProject = Object.values(s.projects)[0];
  const someTask = Object.values(s.tasks)[0];
  const someUser = Object.values(s.users).find((u) => u.kind === 'human');
  const someClient = Object.values(s.clients)[0];
  const stageName = Object.values(s.stages)[0]?.name;
  switch (name) {
    case 'projects.get': return projectIds.map((id) => ({ id }));
    case 'projects.list': return [
      {}, { status: 'all' }, { status: 'archived' }, { filter: 'mine' }, { filter: 'at_risk' }, { health: 'late' }, { health: 'on_track' },
      { stageName }, ...userIds.slice(0, 3).map((leaderId) => ({ leaderId })), ...clientIds.map((clientId) => ({ clientId })),
      ...teamIds.map((teamId) => ({ teamId })),
    ];
    case 'dashboard.get': return [
      {}, { status: 'all' }, ...userIds.slice(0, 3).map((leaderId) => ({ leaderId })), ...clientIds.map((clientId) => ({ clientId })),
      ...teamIds.map((teamId) => ({ teamId })),
    ];
    case 'tasks.get': return taskIds.map((id) => ({ id }));
    case 'tasks.list': return [
      {}, ...projectIds.map((projectId) => ({ projectId })), { filter: 'mine' }, { filter: 'overdue' }, { filter: 'flagged' },
      { filter: 'review_for_me' }, { status: ['done'] }, { dueFrom: TODAY }, ...userIds.slice(0, 3).map((ownerId) => ({ ownerId })),
    ];
    case 'updates.list': return projectIds.flatMap((projectId) =>
      ['all', 'posts', 'decisions', 'tasks', 'files'].map((filter) => ({ projectId, filter })));
    case 'comments.list': return [
      ...taskIds.map((targetId) => ({ targetType: 'task', targetId })),
      ...updateIds.map((targetId) => ({ targetType: 'update', targetId })),
    ];
    case 'files.list': return [
      ...projectIds.map((projectId) => ({ projectId })),
      ...(someTask ? [{ projectId: someTask.projectId, taskId: someTask.id }, { projectId: someTask.projectId, stageId: someTask.stageId }] : []),
    ];
    case 'payments.list':
    case 'tracker.list':
    case 'tracker.export': return [
      ...projectIds.map((projectId) => ({ projectId })),
      ...(name === 'tracker.list' && someProject ? [{ projectId: someProject.id, openOnly: true }, { projectId: someProject.id, type: 'meeting', direction: 'in' }] : []),
      ...(name === 'tracker.export' && someProject ? [{ projectId: someProject.id, type: 'file', side: 'out' }] : []),
    ];
    case 'events.list': return [
      {}, { since: '2026-09-01T00:00:00.000+03:00' }, ...projectIds.map((projectId) => ({ projectId })),
      ...(someTask ? [{ targetType: 'task', targetId: someTask.id }] : []),
      ...(someFile ? [{ targetType: 'file', targetId: someFile.id }] : []),
      ...(someUser ? [{ targetType: 'user', targetId: someUser.id }] : []),
    ];
    case 'search.query': return [
      someProject?.name, someProject?.code, someTask?.title, someFile?.name, someUser?.name, someClient?.name, 'a',
    ].filter((text): text is string => typeof text === 'string' && text.length > 0).map((text) => ({ text: text.slice(0, 20) }));
    case 'deadlines.list': return [{}, { from: TODAY }];
    case 'users.list': return [{}, { includeInactive: true }];
    case 'users.get': return userIds.map((id) => ({ id }));
    case 'notifications.list': return [{}, { unreadOnly: true }];
    case 'chats.messages': return [
      ...conversationIds.map((conversationId) => ({ conversationId })),
      ...(someMessage ? [{ conversationId: someMessage.conversationId, before: someMessage.id, limit: 5 }] : []),
    ];
    case 'projectTemplates.matchPlan': {
      // The Admin reads the matches of a template with each project (the link sheet, fbk_008 item 4). Others get forbidden.
      const plan = Object.values(s.projectTemplates ?? {}).find((template) => template.tasks.length > 0);
      return plan ? projectIds.map((projectId) => ({ projectId, templateId: plan.id })) : [];
    }
    case 'taskTemplates.list': return [{}, ...(stageName ? [{ stageName }] : [])];
    default: return [{}];
  }
}

/** Who runs each call: every person and agent of the sample office, so each right and each branch of "mine" runs. */
function actorsOf(s: State): string[] {
  return Object.values(s.users).filter((u) => u.active).map((u) => u.id);
}

const traced = new Map<string, { kinds: Set<Kind>; runs: number }>();

beforeAll(async () => {
  const state = await buildSeed(TODAY, async () => undefined);
  for (const name of READ_CALLS) {
    const rule = READS[name];
    if (!rule || rule.scope === 'none') continue;
    const def = (calls as unknown as Record<string, AnyCall>)[name];
    const entry = { kinds: new Set<Kind>(), runs: 0 };
    traced.set(name, entry);
    for (const actorId of actorsOf(state)) {
      for (const raw of inputsOf(name, state)) {
        const parsed = def.input.safeParse(raw);
        if (!parsed.success) continue;
        let authorityId: string;
        try {
          authorityId = resolveAuthority(state, actorId, def).authority.id;
        } catch {
          continue;
        }
        const rec = recording(state);
        try {
          executeParsed(def, name, parsed.data, rec.state, { actorId, authorityId, correlationId: 'cor_trace', now: NOW, persistent: true }, undefined);
        } catch (error) {
          if (error instanceof ApiError) continue;
          throw error;
        }
        entry.runs += 1;
        for (const kind of rec.seen) entry.kinds.add(kind);
      }
    }
  }
}, 60_000);

describe('the read map (plan 5.3, client map 3.2)', () => {
  it('has a rule for each read call, and only for read calls', () => {
    expect(Object.keys(READS).sort()).toEqual([...READ_CALLS].sort());
  });

  it('runs each read call that reloads on a signal at least once', () => {
    for (const [name, entry] of traced) expect({ name, runs: entry.runs > 0 }).toEqual({ name, runs: true });
  });

  it('names every kind that each read call reads', () => {
    const missing: Record<string, Kind[]> = {};
    for (const [name, entry] of traced) {
      const lacking = [...entry.kinds].filter((kind) => !READS[name].kinds.includes(kind)).sort();
      if (lacking.length > 0) missing[name] = lacking;
    }
    expect(missing).toEqual({});
  });

  it('records the narrow kinds: a list sorted by the change time names projectTouched, the session names preferences', () => {
    expect(traced.get('projects.list')?.kinds.has('projectTouched')).toBe(true);
    expect(traced.get('session.get')?.kinds.has('preferences')).toBe(true);
    expect(traced.get('clients.list')?.kinds.has('projectTouched')).toBe(false);
  });

  it('knows the project of each project read from its input or its answer', () => {
    expect(READS['projects.get'].projectOf?.({ id: 'prj_007' }, undefined)).toBe('prj_007');
    expect(READS['tasks.list'].projectOf?.({ projectId: 'prj_002' }, undefined)).toBe('prj_002');
    expect(READS['tasks.list'].projectOf?.({}, undefined)).toBeUndefined();
    expect(READS['events.list'].projectOf?.({ projectId: 'prj_003' }, undefined)).toBe('prj_003');
    expect(READS['tasks.get'].projectOf?.({ id: 'tsk_001' }, { task: { projectId: 'prj_004' } })).toBe('prj_004');
    expect(READS['tasks.get'].projectOf?.({ id: 'tsk_001' }, undefined)).toBeUndefined();
    for (const name of ['updates.list', 'files.list', 'payments.list', 'tracker.list', 'tracker.export']) {
      expect(READS[name].projectOf?.({ projectId: 'prj_005' }, undefined)).toBe('prj_005');
    }
  });

  it('never reloads a file link, a file or a screenshot on a signal', () => {
    for (const name of ['files.link', 'files.get', 'feedback.screenshot']) expect(READS[name].scope).toBe('none');
  });
});
