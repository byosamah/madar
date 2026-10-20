import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Meeting } from '../../src/api/contract/entities';
import { runCall } from '../core/runCall';
import { EXTEND_SQL, SETTLE_SQL } from '../jobs/steps/meetings';
import { dropSchema, localClient, migrationFiles } from './migrate';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * The migration of meetings (fbk_022) on the local stack: the table of the Meeting record. The test applies the migrations before
 * it, then this one, and checks the row round trip, the generated columns, the id rule, the indexes and Row Level Security.
 */
const MIGRATION = '20261020000100_meetings.sql';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const schema = `madar_mtg_${process.pid}`;
const STAMP = '2026-10-19T09:00:00.000+03:00';
const OFFICE_MEETING: Meeting = {
  id: 'mtg_001', kind: 'meeting', title: 'Meet a new client', projectId: null, startsAt: '2026-10-21T10:00:00.000+03:00', endsAt: '2026-10-21T11:00:00.000+03:00',
  where: 'Meeting room', guests: '', notes: '', organizerId: 'usr_004', attendeeIds: ['usr_006', 'usr_007'], status: 'scheduled', rev: 1,
  createdBy: 'usr_004', createdAt: STAMP,
};
const PROJECT_MEETING: Meeting = {
  ...OFFICE_MEETING, id: 'mtg_002', kind: 'client', projectId: 'prj_001', startsAt: '2026-10-22T09:00:00.000+03:00', endsAt: '2026-10-22T10:00:00.000+03:00',
  organizerId: 'usr_002', attendeeIds: ['usr_003'], settledAt: '2026-10-22T10:15:00.000+03:00',
};

async function apply(db: pg.Client, names: string[]): Promise<void> {
  await db.query('begin');
  try {
    await db.query("select pg_advisory_xact_lock(hashtext('madar_migrations'))");
    await db.query(`set local search_path to ${schema}`);
    for (const name of names) await db.query(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

describe.runIf(process.env.MADAR_IT === '1')('the meetings migration, on the local database', () => {
  let db: pg.Client;

  beforeAll(async () => {
    db = await localClient();
    await db.query(`drop schema if exists ${schema} cascade`);
    await db.query(`create schema ${schema}`);
    const files = migrationFiles({ platform: false });
    expect(files).toContain(MIGRATION);
    await apply(db, files.filter((name) => name < MIGRATION));
    await apply(db, files.filter((name) => name >= MIGRATION));
    await db.query(`set search_path to ${schema}`);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await dropSchema(db, schema);
    await db.end();
  });

  it('keeps one row for each meeting, and reads it back as the same record', async () => {
    for (const meeting of [OFFICE_MEETING, PROJECT_MEETING]) await db.query('insert into meetings (id, doc) values ($1, $2)', [meeting.id, JSON.stringify(meeting)]);
    const { rows } = await db.query('select doc from meetings order by ord');
    expect(rows.map((row) => Meeting.parse(row.doc))).toEqual([OFFICE_MEETING, PROJECT_MEETING]);
  });

  it('generates the key columns from the doc, with null for a meeting with no project and for a meeting not settled', async () => {
    const { rows } = await db.query('select id, project_id, organizer_id, starts_at, ends_at, status, settled_at from meetings order by ord');
    expect(rows).toEqual([
      { id: 'mtg_001', project_id: null, organizer_id: 'usr_004', starts_at: OFFICE_MEETING.startsAt, ends_at: OFFICE_MEETING.endsAt, status: 'scheduled', settled_at: null },
      { id: 'mtg_002', project_id: 'prj_001', organizer_id: 'usr_002', starts_at: PROJECT_MEETING.startsAt, ends_at: PROJECT_MEETING.endsAt, status: 'scheduled', settled_at: PROJECT_MEETING.settledAt },
    ]);
  });

  it('refuses a row whose id differs from the id in its doc', async () => {
    await expect(db.query('insert into meetings (id, doc) values ($1, $2)', ['mtg_009', JSON.stringify(OFFICE_MEETING)])).rejects.toThrow();
  });

  it('finds the meetings of one attendee and one day window with the loader conditions', async () => {
    const mine = await db.query("select id from meetings t where t.doc->'attendeeIds' ? $1::text order by t.ord", ['usr_006']);
    expect(mine.rows).toEqual([{ id: 'mtg_001' }]);
    const window = await db.query(
      `select id from meetings t where (t.starts_at)::timestamptz >= $1::timestamptz and t.starts_at collate "C" >= $2::text
       and (t.starts_at)::timestamptz < $3::timestamptz and t.starts_at collate "C" < $4::text order by t.ord`,
      ['2026-10-22T00:00:00.000+03:00', '2026-10-20T12:00:00', '2026-10-23T00:00:00.000+03:00', '2026-10-24T12:00:00'],
    );
    expect(window.rows).toEqual([{ id: 'mtg_002' }]);
  });

  it('has the read indexes and the partial index of the settle job (20261021000100_meetings_settle.sql)', async () => {
    const { rows } = await db.query("select indexname from pg_indexes where schemaname = $1 and tablename = 'meetings' order by indexname", [schema]);
    expect(rows.map((row) => row.indexname)).toEqual(['meetings_attendees', 'meetings_pkey', 'meetings_project_starts', 'meetings_starts', 'meetings_to_settle']);
    const [partial] = (await db.query("select indexdef from pg_indexes where schemaname = $1 and indexname = 'meetings_to_settle'", [schema])).rows;
    expect(partial.indexdef).toContain("WHERE ((status = 'scheduled'::text) AND (settled_at IS NULL))");
  });

  it('serves the read of the settle job with the partial index, and the read gives only the meetings that are due', async () => {
    const stamps = ['2026-10-22T09:30:00.000+03:00', '2026-10-08T09:30:00.000+03:00'];
    // Two rows cannot show a plan choice, so the test turns the sequential scan off: the planner then uses the index if the read can.
    await db.query('set enable_seqscan = off');
    try {
      const text = SETTLE_SQL.replace('$1::text', `'${stamps[0]}'::text`).replace('$2::text', `'${stamps[1]}'::text`);
      const plan = (await db.query(`explain ${text}`)).rows.map((row) => String(row['QUERY PLAN'])).join('\n');
      expect(plan).toContain('meetings_to_settle');
      // mtg_002 has its mark, mtg_001 ends on 2026-10-21 at 11:00, so it is due at 2026-10-22 09:30.
      const due = await db.query(SETTLE_SQL, stamps);
      expect(due.rows.map((row) => row.id)).toEqual(['mtg_001']);
    } finally {
      await db.query('reset enable_seqscan');
    }
  });

  it('turns on Row Level Security for the table', async () => {
    const { rows } = await db.query("select relrowsecurity from pg_class where oid = 'meetings'::regclass");
    expect(rows[0].relrowsecurity).toBe(true);
  });
});

/**
 * Privacy of a meeting with no project (fbk_022, owner 2026-10-19, Q4), through runCall on the local database as madar_server: the SQL
 * conditions of the loaders (meetingConds, privateMeetingsOf), the events filter and the signals of the real save. The memory form of
 * the same probes runs in src/api/handlers/meetingLeaks.test.ts and server/core/meetingsSignal.test.ts.
 */
describe.runIf(process.env.MADAR_IT === '1')('a meeting with no project, on the local database', () => {
  const ADMIN = 'usr_001';
  const OUTSIDER = 'usr_002';
  const ATTENDEE = 'usr_003';
  const ORGANIZER = 'usr_004';
  const REMOVED = 'usr_006';
  const TITLE = 'Salary talk DB-5521';
  let office: ItOffice;
  let deps: ReturnType<ItOffice['isolate']>;
  let id: string;
  const call = (userId: string, name: string, input: unknown) => runCall(deps, { principal: { userId }, name, input, batch: newBatch() });

  beforeAll(async () => {
    office = await startOffice('mtg');
    deps = office.isolate();
    const sent = deps.signal.sent.length;
    const made = await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: TITLE, startsAt: '2026-10-06T10:00:00+03:00', attendeeIds: [ATTENDEE, REMOVED] });
    if (!made.ok) throw new Error(`meetings.create failed: ${made.error.message}`);
    id = (made.output as { id: string }).id;
    expect(deps.signal.sent.slice(sent).map((signal) => signal.channel).sort()).toEqual([ATTENDEE, ORGANIZER, REMOVED].map((user) => `person:${user}`));
  }, 60_000);

  afterAll(async () => {
    await office?.close();
  });

  it('keeps the row with no project, and sends its signals to the person channels of its people only', async () => {
    expect(await office.sql('select id, project_id, organizer_id from meetings')).toEqual([{ id, project_id: null, organizer_id: ORGANIZER }]);
    for (const signal of deps.signal.sent) {
      expect(JSON.stringify(signal)).not.toContain(TITLE);
      expect(signal.channel).not.toBe('office');
      expect(signal).not.toHaveProperty('actorId');
    }
  });

  it('lists it for its people and for nobody else, whoever asks, with the filters of the loaders', async () => {
    for (const [person, seen] of [[ORGANIZER, true], [ATTENDEE, true], [REMOVED, true], [ADMIN, false], [OUTSIDER, false]] as const) {
      for (const input of [{ from: '2026-10-01', to: '2026-12-31' }, { from: '2026-10-06', to: '2026-10-06', mine: false, projectId: 'prj_001' }]) {
        const listed = await call(person, 'meetings.list', input);
        if (!listed.ok) throw new Error(listed.error.message);
        expect((listed.output as { id: string }[]).some((row) => row.id === id), `${person} ${JSON.stringify(input)}`).toBe(seen && input.mine === undefined);
      }
    }
  });

  it('answers get, update and cancel for the Admin who is not invited as for an unknown id', async () => {
    for (const [name, input, missing] of [
      ['meetings.get', { id }, { id: 'mtg_999' }], ['meetings.update', { id, notes: 'x' }, { id: 'mtg_999', notes: 'x' }], ['meetings.cancel', { id }, { id: 'mtg_999' }],
    ] as const) {
      const hidden = await call(ADMIN, name, input);
      const gone = await call(ADMIN, name, missing);
      expect(hidden.ok, name).toBe(false);
      if (hidden.ok || gone.ok) continue;
      expect(hidden.error.code, name).toBe('not_found');
      expect(hidden.error.message, name).toBe(gone.error.message.replace('mtg_999', id));
    }
  });

  it('holds none of its events in the History of the Admin or of an outsider, and all of them in the History of the organizer', async () => {
    for (const person of [ADMIN, OUTSIDER]) {
      const listed = await call(person, 'events.list', { limit: 500 });
      if (!listed.ok) throw new Error(listed.error.message);
      expect(JSON.stringify(listed.output), person).not.toContain(TITLE);
    }
    const own = await call(ORGANIZER, 'events.list', { limit: 500 });
    if (!own.ok) throw new Error(own.error.message);
    expect(JSON.stringify(own.output)).toContain('meeting.created');
  });

  it('keeps hiding it from a person who was taken off, and still tells that person by signal', async () => {
    const sent = deps.signal.sent.length;
    const changed = await call(ORGANIZER, 'meetings.update', { id, attendeeIds: [ATTENDEE] });
    expect(changed.ok).toBe(true);
    expect(deps.signal.sent.slice(sent).map((signal) => signal.channel).sort()).toEqual([ATTENDEE, ORGANIZER, REMOVED].map((user) => `person:${user}`));
    const got = await call(REMOVED, 'meetings.get', { id });
    expect(got.ok).toBe(false);
    const listed = await call(REMOVED, 'events.list', { limit: 500 });
    if (!listed.ok) throw new Error(listed.error.message);
    expect(JSON.stringify(listed.output)).not.toContain(TITLE);
  });
});

/**
 * The settle and the minutes (wave 2, owner 2026-10-19) through runCall on the local database as madar_server: the loaders of
 * meetings.settle and meetings.saveMinutes, the Tracker line of a project meeting, the minutes on the meeting for a meeting with no
 * project, and the job read. The memory form of the same probes runs in src/api/handlers/meetingMinutes.test.ts and in
 * server/data/loaders/loaders.test.ts (both loads).
 */
describe.runIf(process.env.MADAR_IT === '1')('the settle and the minutes, on the local database', () => {
  const ADMIN = 'usr_001';
  const ATTENDEE = 'usr_003';
  const ORGANIZER = 'usr_004';
  const OUTSIDER = 'usr_002';
  const MINUTES = 'The raise is 4,000 riyals. DB-MINUTES-7714';
  let office: ItOffice;
  let deps: ReturnType<ItOffice['isolate']>;
  let solo: string;
  let client: string;
  const call = (userId: string, name: string, input: unknown) => runCall(deps, { principal: { userId }, name, input, batch: newBatch() });
  const okOf = <T>(result: Awaited<ReturnType<typeof call>>): T => {
    if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
    return result.output as T;
  };

  beforeAll(async () => {
    office = await startOffice('mtgmin');
    deps = office.isolate();
    // The clock of the suite is 2026-10-04 09:00 in Riyadh, so both meetings ended two days ago.
    solo = okOf<{ id: string }>(await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: 'Salary talk', startsAt: '2026-10-02T09:00:00+03:00', attendeeIds: [ATTENDEE] })).id;
    const leader = office.seed.projects.prj_001.leaderId!;
    client = okOf<{ id: string }>(await call(leader, 'meetings.create', { kind: 'client', title: 'Kick-off', projectId: 'prj_001', startsAt: '2026-10-02T10:00:00+03:00', attendeeIds: [ATTENDEE] })).id;
  }, 60_000);

  afterAll(async () => {
    await office?.close();
  });

  it('settles a project meeting once: one mark, one Tracker line that names its cause, and the same answer the second time', async () => {
    const first = okOf<{ settledAt: string; trackerEntryId: string }>(await call(ATTENDEE, 'meetings.settle', { id: client }));
    expect(first.trackerEntryId).toMatch(/^trk_/);
    const second = okOf<{ settledAt: string; trackerEntryId: string }>(await call(OUTSIDER, 'meetings.settle', { id: client }));
    expect(second).toEqual(first);
    const lines = await office.sql("select id, doc->>'meetingId' as meeting, doc->>'auto' as auto, doc->'minutes' as minutes from tracker where doc->>'meetingId' = $1", [client]);
    expect(lines).toEqual([{ id: first.trackerEntryId, meeting: client, auto: 'meeting', minutes: null }]);
    const marks = await office.sql("select count(*)::int as n from events where doc->>'verb' = 'meeting.settled' and doc->>'targetId' = $1", [client]);
    expect(marks).toEqual([{ n: 1 }]);
    const caused = await office.sql("select doc->>'causeEventId' as cause from events where doc->>'verb' = 'tracker.logged' and doc->>'targetId' = $1", [first.trackerEntryId]);
    expect(caused[0].cause).toMatch(/^evt_/);
  });

  it('refuses the Undo of the mark with settle_final', async () => {
    const [mark] = await office.sql("select id, doc->>'actingForId' as person from events where doc->>'verb' = 'meeting.settled' and doc->>'targetId' = $1", [client]);
    const undone = await call(mark.person as string, 'events.undo', { eventId: mark.id });
    expect(undone.ok).toBe(false);
    if (!undone.ok) expect(undone.error).toMatchObject({ code: 'conflict', details: { reason: 'settle_final' } });
  });

  it('keeps the minutes of a project meeting on its Tracker line, and the minutes of a meeting with no project on the meeting', async () => {
    const line = okOf<{ minutesPlace: string; minutes: { text: string } }>(await call(ATTENDEE, 'meetings.saveMinutes', { id: client, text: MINUTES, fileIds: [] }));
    expect(line).toMatchObject({ minutesPlace: 'tracker', minutes: { text: MINUTES } });
    const onLine = await office.sql("select doc->'minutes'->>'text' as text from tracker where doc->>'meetingId' = $1", [client]);
    expect(onLine).toEqual([{ text: MINUTES }]);
    const own = okOf<{ minutesPlace: string }>(await call(ATTENDEE, 'meetings.saveMinutes', { id: solo, text: MINUTES, fileIds: [] }));
    expect(own.minutesPlace).toBe('meeting');
    const onMeeting = await office.sql("select doc->'minutes'->>'text' as text from meetings where id = $1", [solo]);
    expect(onMeeting).toEqual([{ text: MINUTES }]);
    const event = await office.sql("select doc->>'officeMeetingId' as office from events where doc->>'verb' = 'meeting.minutes_saved' and doc->>'targetId' = $1", [solo]);
    expect(event).toEqual([{ office: solo }]);
  });

  it('refuses a stale since, and takes the Undo of the save', async () => {
    const stale = await call(ATTENDEE, 'meetings.saveMinutes', { id: solo, text: 'Other', fileIds: [], since: '2026-10-01T00:00:00.000+03:00' });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toMatchObject({ code: 'conflict', details: { reason: 'minutes_changed' } });
    const [saved] = await office.sql("select id from events where doc->>'verb' = 'meeting.minutes_saved' and doc->>'targetId' = $1", [solo]);
    okOf(await call(ATTENDEE, 'events.undo', { eventId: saved.id }));
    expect(await office.sql("select doc->'minutes' as minutes from meetings where id = $1", [solo])).toEqual([{ minutes: null }]);
  });

  it('reads a meeting with no project as missing for the Admin who is not invited and for an outsider, for the save as for the read', async () => {
    for (const person of [ADMIN, OUTSIDER]) {
      for (const [name, input] of [['meetings.saveMinutes', { id: solo, text: 'Try', fileIds: [] }], ['meetings.get', { id: solo }], ['meetings.settle', { id: solo }]] as const) {
        const refused = await call(person, name, input);
        expect(refused.ok, `${person} ${name}`).toBe(false);
        if (!refused.ok) expect(refused.error, `${person} ${name}`).toMatchObject({ code: 'not_found', message: `Meeting ${solo} does not exist.` });
      }
    }
  });
});


/**
 * Repeating meetings (wave 3, owner 2026-10-19) through runCall on the local database as madar_server: the loaders of the scope writes
 * (the field seriesId and the start bound) and of meetings.extend, the 8 rows of a new series, and the read of the job. The memory form
 * of the same probes runs in src/api/handlers/meetingSeries.test.ts, meetingExtend.test.ts and server/data/loaders/loaders.test.ts.
 */
describe.runIf(process.env.MADAR_IT === '1')('a repeating series, on the local database', () => {
  const ADMIN = 'usr_001';
  const ATTENDEE = 'usr_006';
  const ORGANIZER = 'usr_004';
  const OUTSIDER = 'usr_002';
  const TITLE = 'Weekly talk DB-SERIES-3318';
  let office: ItOffice;
  let deps: ReturnType<ItOffice['isolate']>;
  let first: string;
  const call = (userId: string, name: string, input: unknown) => runCall(deps, { principal: { userId }, name, input, batch: newBatch() });
  const okOf = <T>(result: Awaited<ReturnType<typeof call>>): T => {
    if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
    return result.output as T;
  };
  const rows = () => office.sql<{ id: string; starts_at: string; status: string; place: string; until: string | null }>(
    "select id, starts_at, status, doc->>'where' as place, doc->'repeat'->>'until' as until from meetings where doc->>'seriesId' = $1 order by starts_at", [first],
  );

  beforeAll(async () => {
    office = await startOffice('mtgser');
    deps = office.isolate();
    // The clock of the suite is Sunday 2026-10-04 09:00 in Riyadh.
    first = okOf<{ id: string }>(await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: TITLE, startsAt: '2026-10-11T09:00:00+03:00', attendeeIds: [ATTENDEE], repeat: { every: 'week', until: null } })).id;
  }, 60_000);

  afterAll(async () => {
    await office?.close();
  });

  it('makes the 8 rows of the series in one save, all with no project, and one notice for each attendee', async () => {
    const list = await rows();
    expect(list.map((row) => String(row.starts_at).slice(0, 10))).toEqual(['2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
    expect(await office.sql('select count(*)::int as n from meetings where project_id is null')).toEqual([{ n: 8 }]);
    const notices = await office.sql("select user_id, dedupe_key from notifications where target_type = 'meeting' order by user_id");
    expect(notices).toEqual([{ user_id: ATTENDEE, dedupe_key: `meeting_invited:${first}:${ATTENDEE}` }]);
  });

  it('answers the scope writes and the extension for the Admin who is not invited and for an outsider as for an unknown id', async () => {
    const [, , third] = await rows();
    for (const person of [ADMIN, OUTSIDER]) {
      for (const [name, input, missing] of [
        ['meetings.update', { id: third.id, where: 'x', scope: 'later' }, { id: 'mtg_999', where: 'x', scope: 'later' }],
        ['meetings.cancel', { id: third.id, scope: 'later' }, { id: 'mtg_999', scope: 'later' }],
        ['meetings.extend', { seriesId: first }, { seriesId: 'mtg_999' }],
      ] as const) {
        const hidden = await call(person, name, input);
        const gone = await call(person, name, missing);
        expect(hidden.ok, `${person} ${name}`).toBe(false);
        if (hidden.ok || gone.ok) continue;
        expect(hidden.error.code, `${person} ${name}`).toBe('not_found');
        expect(hidden.error.message, `${person} ${name}`).toBe(gone.error.message.replace('mtg_999', name === 'meetings.extend' ? first : third.id));
      }
    }
    expect((await rows()).every((row) => row.place === '' && row.status === 'scheduled')).toBe(true);
  });

  it('changes this meeting and the later ones with the scope "later", and cancels the later ones and ends the series', async () => {
    const list = await rows();
    okOf(await call(ORGANIZER, 'meetings.update', { id: list[3].id, where: 'Room 9', scope: 'later' }));
    expect((await rows()).map((row) => row.place)).toEqual(['', '', '', 'Room 9', 'Room 9', 'Room 9', 'Room 9', 'Room 9']);
    okOf(await call(ORGANIZER, 'meetings.cancel', { id: list[6].id, scope: 'later' }));
    const after = await rows();
    expect(after.map((row) => row.status)).toEqual([...Array(6).fill('scheduled'), 'cancelled', 'cancelled']);
    expect(after.slice(6).map((row) => row.until)).toEqual(['2026-11-21', '2026-11-21']);
    // The History of the Admin holds none of it.
    const listed = okOf<unknown[]>(await call(ADMIN, 'events.list', { limit: 500 }));
    expect(JSON.stringify(listed)).not.toContain(TITLE);
  });

  it('adds the missing meeting with meetings.extend, none after a cancelled last meeting, and reads the short series with the statement of the job', async () => {
    // A second series: one meeting alone in the middle is cancelled, so 7 are ahead and the last one is scheduled.
    const other = okOf<{ id: string }>(await call(ORGANIZER, 'meetings.create', { kind: 'meeting', title: 'Second series', startsAt: '2026-10-12T09:00:00+03:00', attendeeIds: [ATTENDEE], repeat: { every: 'week', until: null } })).id;
    const [, , middle] = await office.sql<{ id: string }>("select id from meetings where doc->>'seriesId' = $1 order by starts_at", [other]);
    okOf(await call(ORGANIZER, 'meetings.cancel', { id: middle.id }));
    const read = async () => office.sql<{ doc: { seriesId: string }; ahead: string }>(EXTEND_SQL, ['2026-10-04T09:00:00.000+03:00', '2026-10-04T00:00:00.000+03:00']);
    // The first series ends with a cancelled meeting: out of the read. The second is short.
    expect((await read()).map((row) => [row.doc.seriesId, Number(row.ahead)])).toEqual([[other, 7]]);
    expect(okOf(await call(ORGANIZER, 'meetings.extend', { seriesId: first }))).toEqual({ added: 0 });
    expect(okOf(await call(ORGANIZER, 'meetings.extend', { seriesId: other }))).toEqual({ added: 1 });
    expect(await read()).toEqual([]);
    expect(await office.sql("select count(*)::int as n from meetings where doc->>'seriesId' = $1", [other])).toEqual([{ n: 9 }]);
    const marks = await office.sql("select id from events where doc->>'verb' = 'meeting.extended' and doc->>'targetId' in (select id from meetings where doc->>'seriesId' = $1)", [other]);
    expect(marks).toHaveLength(1);
    expect(okOf(await call(ORGANIZER, 'meetings.extend', { seriesId: other }))).toEqual({ added: 0 });
  });

  it('serves the read of the job with the index of the start', async () => {
    await office.sql('set enable_seqscan = off');
    try {
      const text = EXTEND_SQL.replace('$1::text', "'2026-10-04T09:00:00.000+03:00'::text").replace('$2::text', "'2026-10-04T00:00:00.000+03:00'::text");
      const plan = (await office.sql(`explain ${text}`)).map((row) => String(row['QUERY PLAN'])).join('\n');
      expect(plan).toContain('meetings_starts');
    } finally {
      await office.sql('reset enable_seqscan');
    }
  });
});
