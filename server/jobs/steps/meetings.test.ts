import { describe, expect, it } from 'vitest';
import type { Meeting } from '../../../src/api/contract/entities';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { addMinutes } from '../../../src/lib/meetings';
import { snapshotOf } from '../../data/officeCache';
import { liteData } from '../../data/lite/callData';
import { freshLite } from '../../data/lite/testDb';
import { liteWriteState } from '../../data/lite/whole';
import { createRunCall, type RunCall } from '../../core/runCall';
import { fakeDeps } from '../../test/fakes/deps';
import { meetings, SETTLE_LITE, SETTLE_SQL, settleActorOf } from './meetings';

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
