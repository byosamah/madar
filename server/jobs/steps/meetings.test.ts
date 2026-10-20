import { describe, expect, it } from 'vitest';
import type { Meeting } from '../../../src/api/contract/entities';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { addMinutes, SERIES_AHEAD } from '../../../src/lib/meetings';
import { snapshotOf } from '../../data/officeCache';
import { liteData } from '../../data/lite/callData';
import { freshLite } from '../../data/lite/testDb';
import { liteWriteState } from '../../data/lite/whole';
import { createRunCall, type RunCall } from '../../core/runCall';
import { fakeDeps } from '../../test/fakes/deps';
import { EXTEND_LITE, EXTEND_SQL, extendActorOf, meetings, SETTLE_LITE, SETTLE_SQL, settleActorOf } from './meetings';

/**
 * The job step that settles the meetings that ended (fbk_022, wave 2, owner 2026-10-19). It reads the due meetings with one statement,
 * finds the person who acts for each one, and runs the normal call meetings.settle as that person. On SQLite here, with a stub run for
 * the rows it asks for and the real run for the result. server/it/meetings.it.test.ts holds the plan of the Postgres statement.
 */

const DAY = '2026-10-04';
/** 12:15 Riyadh on a Sunday. */
const AT = new Date('2026-10-04T09:15:00Z');

const meeting = (id: string, endsAt: string, extra: Partial<Meeting> = {}): Meeting => ({
  id, kind: 'client', title: `Secret title ${id}`, projectId: 'prj_001', startsAt: addMinutes(endsAt, -60), endsAt, where: '', guests: '', notes: '',
  organizerId: 'usr_002', attendeeIds: ['usr_003'], status: 'scheduled', rev: 1, createdBy: 'usr_002', createdAt: '2026-09-30T09:00:00.000+03:00', ...extra,
});

async function office(rows: Meeting[], edit: (seed: State) => void = () => undefined) {
  const lite = await freshLite();
  const seed = await buildSeed(DAY, async () => undefined);
  seed.meetings = Object.fromEntries(rows.map((row) => [row.id, row]));
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db });
  deps.clock.set(AT);
  return { ...lite, seed, deps };
}

/** The five meetings of the first test: one due, and four that are not. */
const MIX = [
  meeting('mtg_001', '2026-10-04T12:14:00.000+03:00'),
  meeting('mtg_002', '2026-10-04T12:16:00.000+03:00'),
  meeting('mtg_003', '2026-10-04T10:00:00.000+03:00', { status: 'cancelled' }),
  meeting('mtg_004', '2026-10-04T10:00:00.000+03:00', { settledAt: '2026-10-04T10:15:00.000+03:00' }),
  meeting('mtg_005', '2026-09-19T11:00:00.000+03:00'),
];

type Request = Parameters<RunCall>[1];
function stub(fail: string[] = []) {
  const seen: Request[] = [];
  const run: RunCall = async (_deps, req) => {
    seen.push(req);
    const id = (req.input as { id: string }).id;
    if (fail.includes(id)) return { ok: false, error: { code: 'conflict', message: `Could not settle ${id} Secret title` } };
    return { ok: true, output: { settledAt: '2026-10-04T12:15:00.000+03:00', trackerEntryId: null }, changed: true };
  };
  return { seen, run };
}

describe('the meetings step of the 15-minute job', () => {
  it('finds only the meetings that are due: ended, scheduled, not settled, and not older than 14 days', async () => {
    const { deps } = await office(MIX);
    const { seen, run } = stub();
    deps.runCall = run;
    expect(await meetings(deps, AT)).toEqual({ settled: 1, skipped: 0, failed: 0, extended: 0 });
    expect(seen.map((req) => [req.name, req.input, req.principal])).toEqual([['meetings.settle', { id: 'mtg_001' }, { userId: 'usr_002' }]]);
  });

  it('reads at most 20 meetings, the oldest end first, and names the same conditions in both SQL texts', () => {
    for (const text of [SETTLE_SQL, SETTLE_LITE]) {
      expect(text).toContain("status = 'scheduled'");
      expect(text).toContain('settled_at is null');
      expect(text).toContain('limit 20');
    }
    expect(SETTLE_SQL).toContain('collate "C"');
    expect(SETTLE_LITE).not.toContain('collate');
  });

  it('writes nothing in a second run: the meeting has its mark and the Tracker line is made once', async () => {
    const { deps, db } = await office([MIX[0]]);
    deps.runCall = createRunCall({ data: liteData });
    expect(await meetings(deps, AT)).toEqual({ settled: 1, skipped: 0, failed: 0, extended: 0 });
    const lines = () => db.statement<{ id: string }>('read', "select id from tracker where json_extract(doc, '$.auto') = 'meeting'");
    const after = await lines();
    expect(after).toHaveLength(1);
    expect(await meetings(deps, AT)).toEqual({ settled: 0, skipped: 0, failed: 0, extended: 0 });
    expect(await lines()).toEqual(after);
    const [row] = await db.statement<{ settled_at: string }>('read', 'select settled_at from meetings where id = ?1', ['mtg_001']);
    expect(row.settled_at).toBe('2026-10-04T12:15:00.000+03:00');
  });

  it('makes the organizer the author of the Tracker line, also when the organizer is off and the Admin acts (fix of 2026-10-19)', async () => {
    const { deps, db } = await office([MIX[0]], (seed) => {
      seed.users.usr_002 = { ...seed.users.usr_002, active: false };
    });
    deps.runCall = createRunCall({ data: liteData });
    expect(await meetings(deps, AT)).toEqual({ settled: 1, skipped: 0, failed: 0, extended: 0 });
    const [line] = await db.statement<{ id: string; author: string }>('read', "select id, json_extract(doc, '$.createdBy') as author from tracker where json_extract(doc, '$.auto') = 'meeting'");
    expect(line.author).toBe('usr_002');
    // The Admin made the call, so the event of the line names the Admin as the actor.
    const logged = await db.statement<{ actor: string }>('read', "select json_extract(doc, '$.actorId') as actor from events where json_extract(doc, '$.verb') = 'tracker.logged' and json_extract(doc, '$.targetId') = ?1", [line.id]);
    expect(logged).toEqual([{ actor: 'usr_001' }]);
  });

  it('goes on after a failure, and logs the id and the code, never the title', async () => {
    const { deps } = await office([meeting('mtg_001', '2026-10-04T12:00:00.000+03:00'), meeting('mtg_002', '2026-10-04T12:10:00.000+03:00')]);
    const { seen, run } = stub(['mtg_001']);
    deps.runCall = run;
    expect(await meetings(deps, AT)).toEqual({ settled: 1, skipped: 0, failed: 1, extended: 0 });
    expect(seen.map((req) => (req.input as { id: string }).id)).toEqual(['mtg_001', 'mtg_002']);
    const line = deps.logs.find((one) => one.fields?.step === 'meetings');
    expect(line?.fields).toEqual({ step: 'meetings', id: 'mtg_001', error: 'conflict' });
    expect(JSON.stringify(deps.logs)).not.toContain('Secret title');
  });

  it('counts a call that settled nothing as not settled', async () => {
    const { deps } = await office([MIX[0]]);
    deps.runCall = async () => ({ ok: true, output: { settledAt: null, trackerEntryId: null }, changed: false });
    expect(await meetings(deps, AT)).toEqual({ settled: 0, skipped: 0, failed: 0, extended: 0 });
  });

  it('settles the oldest end first, at most 20 in one run, and the rest in the next run', async () => {
    const rows = Array.from({ length: 23 }, (_, n) => meeting(`mtg_${String(n + 1).padStart(3, '0')}`, `2026-10-04T${String(1 + Math.floor(n / 6)).padStart(2, '0')}:${String((n % 6) * 10).padStart(2, '0')}:00.000+03:00`));
    const { deps } = await office(rows);
    const { seen, run } = stub();
    deps.runCall = run;
    expect((await meetings(deps, AT)).settled).toBe(20);
    expect(seen.map((req) => (req.input as { id: string }).id)).toEqual(rows.slice(0, 20).map((row) => row.id));
  });
});

describe('the person who acts for a meeting', () => {
  const users = (extra: Record<string, unknown> = {}) => snapshotOf({
    users: {
      usr_001: { id: 'usr_001', kind: 'human', active: true, systemRole: 'admin' },
      usr_002: { id: 'usr_002', kind: 'human', active: true, systemRole: 'member' },
      usr_003: { id: 'usr_003', kind: 'human', active: true, systemRole: 'member' },
      usr_004: { id: 'usr_004', kind: 'human', active: true, systemRole: 'member' },
      usr_005: { id: 'usr_005', kind: 'human', active: false, systemRole: 'admin' },
      usr_006: { id: 'usr_006', kind: 'human', active: false, systemRole: 'member' },
      usr_009: { id: 'usr_009', kind: 'agent', active: true, systemRole: 'member' },
      ...extra,
    },
  } as never, 1);

  it('is the organizer while the organizer is an active person', () => {
    expect(settleActorOf(users(), { organizerId: 'usr_002', projectId: 'prj_001', attendeeIds: ['usr_003'] })).toBe('usr_002');
    expect(settleActorOf(users(), { organizerId: 'usr_002', projectId: null, attendeeIds: ['usr_003'] })).toBe('usr_002');
  });

  it('is the first active Admin by id for a project meeting whose organizer is off', () => {
    expect(settleActorOf(users(), { organizerId: 'usr_006', projectId: 'prj_001', attendeeIds: ['usr_003'] })).toBe('usr_001');
    // The Admin that is off never acts.
    expect(settleActorOf(users({ usr_001: { id: 'usr_001', kind: 'human', active: false, systemRole: 'admin' } }), { organizerId: 'usr_006', projectId: 'prj_001', attendeeIds: [] })).toBeNull();
  });

  it('is the first active attendee by id for a meeting with no project whose organizer is off, and never the Admin', () => {
    expect(settleActorOf(users(), { organizerId: 'usr_006', projectId: null, attendeeIds: ['usr_006', 'usr_004', 'usr_003'] })).toBe('usr_003');
    expect(settleActorOf(users(), { organizerId: 'usr_006', projectId: null, attendeeIds: ['usr_006', 'usr_005'] })).toBeNull();
    expect(settleActorOf(users(), { organizerId: 'usr_006', projectId: null, attendeeIds: [] })).toBeNull();
  });

  it('extends a series as a person who may change it: the organizer, else the first Admin of a project series, else nobody', () => {
    expect(extendActorOf(users(), { organizerId: 'usr_002', projectId: null, attendeeIds: ['usr_003'] })).toBe('usr_002');
    expect(extendActorOf(users(), { organizerId: 'usr_006', projectId: 'prj_001', attendeeIds: ['usr_003'] })).toBe('usr_001');
    // An attendee may read a private meeting but not change it, so a private series of an organizer who left stops.
    expect(extendActorOf(users(), { organizerId: 'usr_006', projectId: null, attendeeIds: ['usr_004', 'usr_003'] })).toBeNull();
  });

  it('counts a meeting with nobody to act as skipped', async () => {
    const { deps } = await office([meeting('mtg_001', '2026-10-04T12:00:00.000+03:00', { projectId: null, organizerId: 'usr_006', attendeeIds: [] })], (seed) => {
      seed.users.usr_006 = { ...seed.users.usr_003, id: 'usr_006', active: false };
    });
    const { seen, run } = stub();
    deps.runCall = run;
    expect(await meetings(deps, AT)).toEqual({ settled: 0, skipped: 1, failed: 0, extended: 0 });
    expect(seen).toEqual([]);
  });
});

/**
 * The second half of the step (wave 3): keep the series full. One read gives the last meeting of each series that has fewer than 8
 * meetings ahead, and for each one the step runs the normal call meetings.extend, as the organizer.
 */
describe('the meetings step keeps the series full (fbk_022, wave 3)', () => {
  const DAYS = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'];
  /** A weekly series of "count" meetings from Monday 2026-10-05 at 10:00, all ahead of the run. */
  const weekly = (seriesId: string, count: number, extra: Partial<Meeting> = {}): Meeting[] =>
    DAYS.slice(0, count).map((day, n) => meeting(`${seriesId}${String(n + 1).padStart(2, '0')}`, `${day}T11:00:00.000+03:00`, { seriesId, repeat: { every: 'week', until: null }, ...extra }));

  type Extend = { seriesId: string; userId: string };
  function extendStub(options: { fail?: string[]; added?: number } = {}) {
    const seen: Extend[] = [];
    const run: RunCall = async (_deps, req) => {
      // A meeting of the test that is over settles with no change here: the settle half of the step has its own tests above.
      if (req.name === 'meetings.settle') return { ok: true, output: { settledAt: null, trackerEntryId: null }, changed: false };
      const input = req.input as { seriesId: string };
      seen.push({ seriesId: input.seriesId, userId: (req.principal as { userId: string }).userId });
      if (options.fail?.includes(input.seriesId)) return { ok: false, error: { code: 'conflict', message: 'Could not extend Secret title' } };
      return { ok: true, output: { added: options.added ?? 2 }, changed: true };
    };
    return { seen, run };
  }

  it('asks for the series that have meetings ahead but fewer than 8, and for no other', async () => {
    const rows = [
      ...weekly('mtg_101', 3),
      // 8 ahead: full. 7 ahead with the last scheduled: short.
      ...weekly('mtg_102', 8), ...weekly('mtg_103', 7),
      // The last meeting is cancelled alone: that does not end the series (owner, 2026-10-23), so it is short and read.
      ...weekly('mtg_104', 5).map((row, n) => (n === 4 ? { ...row, status: 'cancelled' as const } : row)),
      // The last day is reached: nothing to add, so no call.
      ...weekly('mtg_105', 3, { repeat: { every: 'week', until: '2026-10-19' } }),
      // Every meeting is over: the series is not in the read.
      ...weekly('mtg_106', 2).map((row, n) => ({ ...row, startsAt: `2026-09-2${n}T10:00:00.000+03:00`, endsAt: `2026-09-2${n}T11:00:00.000+03:00` })),
      // One meeting in no series.
      meeting('mtg_190', '2026-10-06T11:00:00.000+03:00'),
    ];
    const { deps } = await office(rows);
    const { seen, run } = extendStub({ added: 5 });
    deps.runCall = run;
    expect(await meetings(deps, AT)).toEqual({ settled: 0, skipped: 0, failed: 0, extended: 15 });
    // The fewest ahead first, then by series.
    expect(seen).toEqual([{ seriesId: 'mtg_101', userId: 'usr_002' }, { seriesId: 'mtg_104', userId: 'usr_002' }, { seriesId: 'mtg_103', userId: 'usr_002' }]);
  });

  it('reads at most 20 series, the fewest ahead first, and the rest in the next run', async () => {
    const rows = Array.from({ length: 23 }, (_, n) => weekly(`mtg_${200 + n}`, 1 + (n % 7))).flat();
    const { deps } = await office(rows);
    const { seen, run } = extendStub({ added: 1 });
    deps.runCall = run;
    const report = await meetings(deps, AT);
    expect(seen).toHaveLength(20);
    expect(report.extended).toBe(20);
    // 23 series with 1 to 7 ahead: order by the number ahead, then the id. The three with the most ahead wait.
    const aheadOf = (id: string) => rows.filter((row) => row.seriesId === id).length;
    const order = seen.map((one) => aheadOf(one.seriesId));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(Math.max(...order)).toBeLessThanOrEqual(7);
    expect(new Set(seen.map((one) => one.seriesId)).size).toBe(20);
  });

  it('names the same conditions in both SQL texts, with the number of meetings to keep ahead', () => {
    for (const text of [EXTEND_SQL, EXTEND_LITE]) {
      expect(text).toContain("status = 'scheduled'");
      expect(text).toContain(`ahead < ${SERIES_AHEAD}`);
      expect(text).toContain('limit 20');
      expect(text).toContain('row_number() over');
    }
    expect(EXTEND_SQL).toContain('collate "C"');
    expect(EXTEND_SQL).toContain("doc->>'seriesId'");
    expect(EXTEND_LITE).not.toContain('collate');
    expect(EXTEND_LITE).toContain("json_extract(doc, '$.seriesId')");
  });

  it('runs the call as the organizer; for an organizer who is off, as the first Admin of a project series, and skips a private series, which nobody '
    + 'else may change (review 2026-10-20)', async () => {
    const rows = [
      ...weekly('mtg_111', 2, { organizerId: 'usr_006', projectId: 'prj_001', attendeeIds: ['usr_003'] }),
      ...weekly('mtg_112', 2, { organizerId: 'usr_006', projectId: null, attendeeIds: ['usr_006', 'usr_004', 'usr_003'] }),
      ...weekly('mtg_113', 2, { organizerId: 'usr_006', projectId: null, attendeeIds: [] }),
    ];
    const { deps } = await office(rows, (seed) => {
      seed.users.usr_006 = { ...seed.users.usr_003, id: 'usr_006', active: false };
    });
    const { seen, run } = extendStub({ added: 1 });
    deps.runCall = run;
    const report = await meetings(deps, AT);
    expect(report).toEqual({ settled: 0, skipped: 2, failed: 0, extended: 1 });
    expect(seen).toEqual([{ seriesId: 'mtg_111', userId: 'usr_001' }]);
  });

  it('asks for no series of a project that is completed or archived', async () => {
    const rows = [...weekly('mtg_101', 2), ...weekly('mtg_102', 2, { projectId: 'prj_002' }), ...weekly('mtg_103', 2, { projectId: 'prj_003' }), ...weekly('mtg_104', 2, { projectId: null })];
    const { deps, seed } = await office(rows, (state) => {
      state.projects.prj_002 = { ...state.projects.prj_001, id: 'prj_002', status: 'completed' };
      state.projects.prj_003 = { ...state.projects.prj_001, id: 'prj_003', status: 'on_hold' };
    });
    expect(seed.projects.prj_002.status).toBe('completed');
    const { seen, run } = extendStub({ added: 1 });
    deps.runCall = run;
    expect(await meetings(deps, AT)).toEqual({ settled: 0, skipped: 0, failed: 0, extended: 3 });
    expect(seen.map((one) => one.seriesId)).toEqual(['mtg_101', 'mtg_103', 'mtg_104']);
  });

  it('goes on after a failure, and logs the series id and the code, never the title', async () => {
    const { deps } = await office([...weekly('mtg_101', 2), ...weekly('mtg_102', 3)]);
    const { seen, run } = extendStub({ fail: ['mtg_101'], added: 4 });
    deps.runCall = run;
    expect(await meetings(deps, AT)).toEqual({ settled: 0, skipped: 0, failed: 1, extended: 4 });
    expect(seen.map((one) => one.seriesId)).toEqual(['mtg_101', 'mtg_102']);
    const line = deps.logs.find((one) => one.fields?.step === 'meetings');
    expect(line?.fields).toEqual({ step: 'meetings', id: 'mtg_101', error: 'conflict' });
    expect(JSON.stringify(deps.logs)).not.toContain('Secret title');
  });

  it('settles the meetings that ended and keeps the series full in one run', async () => {
    const { deps } = await office([meeting('mtg_199', '2026-10-04T12:14:00.000+03:00'), ...weekly('mtg_101', 3)]);
    const seen: string[] = [];
    deps.runCall = async (_deps, req) => {
      seen.push(req.name);
      return req.name === 'meetings.settle'
        ? { ok: true, output: { settledAt: '2026-10-04T12:15:00.000+03:00', trackerEntryId: null }, changed: true }
        : { ok: true, output: { added: 5 }, changed: true };
    };
    expect(await meetings(deps, AT)).toEqual({ settled: 1, skipped: 0, failed: 0, extended: 5 });
    expect(seen).toEqual(['meetings.settle', 'meetings.extend']);
  });

  it('makes the missing meetings with the real call, once: a second run adds none and writes nothing', async () => {
    const { deps, db } = await office(weekly('mtg_101', 3, { attendeeIds: ['usr_003'] }));
    deps.runCall = createRunCall({ data: liteData });
    expect(await meetings(deps, AT)).toEqual({ settled: 0, skipped: 0, failed: 0, extended: 5 });
    const rows = () => db.statement<{ id: string; starts_at: string }>('read', "select id, starts_at from meetings where json_extract(doc, '$.seriesId') = 'mtg_101' order by starts_at");
    const after = await rows();
    expect(after).toHaveLength(8);
    expect(after.slice(3).map((row) => row.starts_at.slice(0, 10))).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
    // The new meetings are scheduled, have no settle mark, and the events name the mark that caused them.
    const marks = await db.statement<{ id: string }>('read', "select json_extract(doc, '$.id') as id from events where json_extract(doc, '$.verb') = 'meeting.extended'");
    expect(marks).toHaveLength(1);
    const added = await db.statement<{ cause: string }>('read', "select json_extract(doc, '$.causeEventId') as cause from events where json_extract(doc, '$.verb') = 'meeting.added'");
    expect(added).toHaveLength(5);
    expect(new Set(added.map((row) => row.cause))).toEqual(new Set([marks[0].id]));
    expect(await meetings(deps, AT)).toEqual({ settled: 0, skipped: 0, failed: 0, extended: 0 });
    expect(await rows()).toEqual(after);
  });

  it('makes no call when the read finds nothing', async () => {
    const { deps } = await office([meeting('mtg_190', '2026-10-06T11:00:00.000+03:00')]);
    const { seen, run } = extendStub();
    deps.runCall = run;
    expect(await meetings(deps, AT)).toEqual({ settled: 0, skipped: 0, failed: 0, extended: 0 });
    expect(seen).toEqual([]);
  });
});
