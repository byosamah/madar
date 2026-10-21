import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { fakeDeps } from '../test/fakes/deps';
import { everyCall } from './everyCall';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';
import type { RunResult } from './types';

/**
 * The parity fixture of role rights version 2 (design section 8). It records the answer of every shared call of server/core/everyCall.ts
 * for eight people of the sample office, and the flags that the read calls give them (viewerCan and the other can fields). It was
 * recorded on the code before role rights version 2. With the default settings, the new code must give the same record: nobody gains
 * and nobody loses a power on release day. A flag may only gain new keys, so the test compares the old keys only.
 *
 * To record again (only when a difference is on purpose and the owner knows): RIGHTS_PARITY_RECORD=1 npx vitest run server/core/rightsParity.test.ts
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const FIXTURE = new URL('./rightsParity.fixture.json', import.meta.url);

/** The people of the run. The old role holds payment.manage, templates.manageAll and project.editCode. prj_001: leader usr_002, team usr_005. */
const PEOPLE: Readonly<Record<string, string>> = {
  admin: 'usr_001',
  management: 'usr_010',
  accounting: 'usr_011',
  member: 'usr_003',
  oldRole: 'usr_008',
  leader: 'usr_002',
  team: 'usr_005',
  outsider: 'usr_007',
};

type Fixture = { calls: Record<string, string>; sequence: Record<string, string>; flags: Record<string, unknown> };

let office: State;
beforeAll(async () => {
  const seed = await buildSeed('2026-10-04', async () => undefined);
  office = structuredClone(seed);
  office.settings.roles = { custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage', 'templates.manageAll', 'project.editCode'] }] } as never;
});

const batch = () => ({ storyRefs: new Map(), overviewCalls: 0 });

function runnerOn(state: State) {
  const mem = memoryData(state);
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: () => mem.data() });
  return {
    mem,
    call: (userId: string, name: string, input: unknown): Promise<RunResult> => run(deps, { principal: { userId }, name, input, batch: batch() }),
  };
}

/** One answer as a short text: ok, or the error code and the reason. The message is not recorded, so a new wording does not break the record. */
function answerOf(result: RunResult): string {
  if (result.ok) return 'ok';
  const reason = (result.error.details as { reason?: unknown } | undefined)?.reason;
  return `${result.error.code}:${typeof reason === 'string' ? reason : ''}`;
}

/** The boolean fields that tell a screen what the viewer may do: viewerCan, and every field that starts with "can". */
function flagsOf(value: unknown, into: Record<string, boolean> = {}, path = ''): Record<string, boolean> {
  if (Array.isArray(value)) {
    value.forEach((item, i) => flagsOf(item, into, `${path}[${(item as { id?: string })?.id ?? i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === 'boolean' && (path.endsWith('viewerCan') || /^can[A-Z]/.test(key))) into[`${path}.${key}`] = item;
      else if (key === 'viewerCan' || (item !== null && typeof item === 'object' && !['project', 'task', 'file', 'entry', 'meeting', 'event', 'history'].includes(key))) flagsOf(item, into, `${path}.${key}`);
    }
  }
  return into;
}

/** An office with an office to-do, a project meeting, a meeting with no project and a Tracker line, made by people of the sample office. */
async function flagOffice(): Promise<{ office: State; ids: { task: string; ownTask: string; officeTask: string; meeting: string; privateMeeting: string } }> {
  const { mem, call } = runnerOn(office);
  const task = Object.values(office.tasks).find((t) => t.projectId === 'prj_001' && t.status !== 'done')!;
  const made = await call('usr_005', 'tasks.create', { title: 'Office to-do of the record', ownerId: 'usr_006' });
  const own = await call('usr_005', 'tasks.create', { projectId: 'prj_001', title: 'To-do of the team member', ownerId: 'usr_005' });
  const meeting = await call('usr_002', 'meetings.create', {
    kind: 'client', title: 'Record meeting', projectId: 'prj_001', startsAt: '2026-10-09T10:00:00+03:00', attendeeIds: ['usr_005'],
  });
  const privateMeeting = await call('usr_005', 'meetings.create', {
    kind: 'team', title: 'Record private meeting', projectId: null, startsAt: '2026-10-09T12:00:00+03:00', attendeeIds: ['usr_006'],
  });
  const idOf = (r: RunResult, path: string[]): string => {
    if (!r.ok) throw new Error(`setup failed: ${r.error.code} ${r.error.message}`);
    return path.reduce((o: unknown, k) => (o as Record<string, unknown>)[k], r.output) as string;
  };
  return {
    office: mem.tables.state,
    ids: { task: task.id, ownTask: idOf(own, ['task', 'id']), officeTask: idOf(made, ['task', 'id']), meeting: idOf(meeting, ['id']), privateMeeting: idOf(privateMeeting, ['id']) },
  };
}

async function recordFlags(): Promise<Record<string, unknown>> {
  const set = await flagOffice();
  const { call } = runnerOn(set.office);
  const out: Record<string, unknown> = {};
  for (const [label, userId] of Object.entries(PEOPLE)) {
    const reads: [string, string, unknown][] = [
      ['project', 'projects.get', { id: 'prj_001' }],
      ['projects', 'projects.list', {}],
      ['task', 'tasks.get', { id: set.ids.task }],
      ['ownTask', 'tasks.get', { id: set.ids.ownTask }],
      ['taskComments', 'comments.list', { targetType: 'task', targetId: set.ids.task }],
      ['projectFiles', 'files.list', { projectId: 'prj_001' }],
      ['updates', 'updates.list', { projectId: 'prj_001' }],
      ['officeTask', 'tasks.get', { id: set.ids.officeTask }],
      ['meeting', 'meetings.get', { id: set.ids.meeting }],
      ['privateMeeting', 'meetings.get', { id: set.ids.privateMeeting }],
      ['tracker', 'tracker.list', { projectId: 'prj_001' }],
    ];
    for (const [name, callName, input] of reads) {
      const result = await call(userId, callName, input);
      out[`${label}|${name}`] = result.ok ? flagsOf(result.output) : answerOf(result);
    }
  }
  return out;
}

/** Every call in its own copy of the office, for one person: no call changes what another call finds. */
async function recordIsolated(userId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const item of everyCall(office)) {
    const { call } = runnerOn(office);
    out[item.name] = answerOf(await call(userId, item.name, item.input));
  }
  return out;
}

/** The whole list in its order on one copy of the office, for one person, as the list runs in runCall.test.ts. */
async function recordSequence(userId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { call } = runnerOn(office);
  for (const item of everyCall(office)) out[item.name] = answerOf(await call(userId, item.name, item.input));
  return out;
}

async function record(): Promise<Fixture> {
  const calls: Record<string, string> = {};
  const sequence: Record<string, string> = {};
  for (const [label, userId] of Object.entries(PEOPLE)) {
    for (const [name, answer] of Object.entries(await recordIsolated(userId))) calls[`${label}|${name}`] = answer;
    for (const [name, answer] of Object.entries(await recordSequence(userId))) sequence[`${label}|${name}`] = answer;
  }
  return { calls, sequence, flags: await recordFlags() };
}

describe('rights parity (role rights version 2, design section 8)', () => {
  it('gives the same answers as the recorded code, for every call and every person', async () => {
    const fresh = await record();
    if (process.env.RIGHTS_PARITY_RECORD === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 1)}\n`);
      return;
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
    expect(Object.keys(fixture.calls).length).toBeGreaterThan(1000);
    expect(fresh.calls).toEqual(fixture.calls);
    expect(fresh.sequence).toEqual(fixture.sequence);
    // A flag may gain new keys. Every recorded key keeps its value.
    for (const [key, old] of Object.entries(fixture.flags)) {
      const now = fresh.flags[key];
      if (typeof old === 'string') expect(now, key).toBe(old);
      else expect(Object.fromEntries(Object.keys(old as object).map((k) => [k, (now as Record<string, boolean>)[k]])), key).toEqual(old);
    }
  }, 110_000);

  it('records a spread of answers: the Admin passes more calls than the outsider, and some calls are refused for each person', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
    const oks = (label: string) => Object.entries(fixture.calls).filter(([k, v]) => k.startsWith(`${label}|`) && v === 'ok').length;
    expect(oks('admin')).toBeGreaterThan(oks('outsider'));
    expect(oks('outsider')).toBeGreaterThan(20);
    expect(Object.values(fixture.calls).some((v) => v.startsWith('forbidden'))).toBe(true);
  });
});
