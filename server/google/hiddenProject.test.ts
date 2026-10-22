import { beforeEach, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { liteSave } from '../data/lite/save';
import { liteLoadWhole } from '../data/lite/whole';
import { gcalRows } from './rows';
import { GCAL_CALLS, resetAccessCache, syncOne } from './sync';
import { googleOffice, outboxRows, type GoogleOffice } from './testOffice';

/**
 * Google Calendar and a hidden project (hidden projects, owner 2026-10-22, wave D3). A meeting of a hidden project syncs only for the
 * people who view the project. A person who loses the view (taken off the team, a new leader, a change of who sees the project) loses the
 * Google event. Reem is usr_003, Sara usr_005, Noura usr_011 (Accounting). prj_001 has the leader usr_002.
 */

beforeEach(() => resetAccessCache());

const HIDDEN = 'prj_001';
const START = '2026-10-23T10:00:00.000+03:00';
const ok = (result: Awaited<ReturnType<GoogleOffice['call']>>) => {
  if (!result.ok) throw new Error(`The call failed: ${JSON.stringify(result.error)}`);
  return result.output as Record<string, unknown>;
};
const methods = (t: GoogleOffice) => t.google.eventRequests().map((request) => request.method);

/** Changes the State of the test office with the save step, so the office lists follow. */
async function change(t: GoogleOffice, edit: (state: State) => void): Promise<void> {
  await t.db.tx('write', async (q) => {
    const before = await liteLoadWhole(q);
    const after = structuredClone(before);
    edit(after);
    await liteSave(q, before, after, { signals: false });
  });
}
const hide = (viewerIds: string[] = []) => (state: State) => {
  state.projects[HIDDEN] = { ...state.projects[HIDDEN], access: { hidden: true, viewerIds } };
};

/** A client meeting of the project that Noura attends, after she joined the team, with her calendar connected. */
async function world(o: { hidden: boolean }) {
  const t = await googleOffice();
  if (o.hidden) await change(t, hide());
  ok(await t.call('usr_001', 'members.add', { projectId: HIDDEN, userId: 'usr_011' }));
  ok(await t.connect('usr_011'));
  t.google.requests.length = 0;
  const made = ok(await t.call('usr_002', 'meetings.create', { kind: 'client', title: 'Hidden kickoff', projectId: HIDDEN, startsAt: START, attendeeIds: ['usr_011'] }));
  return { t, id: made.id as string };
}

describe('the calls that can take away the view', () => {
  it('are in GCAL_CALLS: projects.setAccess, members.remove and projects.setLeader', () => {
    for (const name of ['projects.setAccess', 'members.remove', 'projects.setLeader', 'roles.update', 'roles.delete', 'users.update']) expect(GCAL_CALLS as readonly string[]).toContain(name);
  });
});

describe('a person taken off the team of a hidden project', () => {
  it('loses the Google event of its meeting', async () => {
    const { t, id } = await world({ hidden: true });
    expect(methods(t)).toEqual(['POST']);
    ok(await t.call('usr_001', 'members.remove', { projectId: HIDDEN, userId: 'usr_011' }));
    expect(methods(t)).toEqual(['POST', 'DELETE']);
    expect((await outboxRows(t, 'gcal.sync')).map((row) => row.payload).at(-1)).toEqual({ userId: 'usr_011', meetingId: id });
  });

  it('keeps the Google event when the project is open, because the person still views it', async () => {
    const { t } = await world({ hidden: false });
    ok(await t.call('usr_001', 'members.remove', { projectId: HIDDEN, userId: 'usr_011' }));
    expect(methods(t)).toEqual(['POST']);
  });
});

describe('gcalRows for a project that the save touched', () => {
  it('writes a row for each person with an event of a meeting of the project, when the save touched no meeting', async () => {
    const { t, id } = await world({ hidden: true });
    const rows = await t.db.tx('read', (q) => gcalRows(q, { hiddenProjects: [HIDDEN] }));
    expect(rows).toEqual([{ kind: 'gcal.sync', payload: { userId: 'usr_011', meetingId: id } }]);
    // A save that touched a meeting names its meetings only.
    const named = await t.db.tx('read', (q) => gcalRows(q, { meetingIds: [id], hiddenProjects: [HIDDEN] }));
    expect(named).toHaveLength(1);
  });

  it('names the meetings of the project and the meetings that the save touched together', async () => {
    const { t, id } = await world({ hidden: true });
    ok(await t.call('usr_001', 'meetings.create', { kind: 'client', title: 'Other kickoff', projectId: 'prj_002', startsAt: START, attendeeIds: ['usr_011'] }));
    const other = (await t.db.statement('read', "select id from meetings where project_id = 'prj_002'", []) as { id: string }[])[0].id;
    await t.db.statement('write', "insert or replace into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ('usr_011', ?1, 'ev', 1, '2026-10-21T06:00:00.000Z')", [other]);
    const rows = await t.db.tx('read', (q) => gcalRows(q, { meetingIds: [other], hiddenProjects: [HIDDEN] }));
    expect(rows.map((row) => (row.payload as { meetingId: string }).meetingId).sort()).toEqual([id, other].sort());
  });

  it('asks the database nothing for a save that touched no meeting and no hidden project', async () => {
    const t = await googleOffice();
    expect(await t.db.tx('read', (q) => gcalRows(q, { hiddenProjects: [] }))).toEqual([]);
  });
});

describe('gcal.sync of a meeting of a hidden project', () => {
  it('puts the event for a person who views the project, and deletes it for a person who does not', async () => {
    const { t, id } = await world({ hidden: false });
    // The project becomes hidden and Noura is not on its team: she loses the view, though she still attends.
    ok(await t.call('usr_001', 'members.remove', { projectId: HIDDEN, userId: 'usr_011' }));
    await change(t, hide());
    t.google.requests.length = 0;
    expect(await syncOne(t.deps as never, 'usr_011', id)).toBe('deleted');
    expect(methods(t)).toEqual(['DELETE']);
    // A chosen person views it again.
    await change(t, hide(['usr_011']));
    expect(await syncOne(t.deps as never, 'usr_011', id)).toBe('put');
  });
});

describe('a person who loses "See every project"', () => {
  /** Omar (usr_004) is a Member who works on no project. He attends a client meeting of the open project prj_002, with his calendar connected. */
  async function omar() {
    const t = await googleOffice();
    ok(await t.connect('usr_004'));
    t.google.requests.length = 0;
    const made = ok(await t.call('usr_003', 'meetings.create', { kind: 'client', title: 'Open kickoff', projectId: 'prj_002', startsAt: START, attendeeIds: ['usr_004'] }));
    expect(methods(t)).toEqual(['POST']);
    return { t, id: made.id as string };
  }

  it('loses the Google event when the Member role turns "See every project" off (roles.update)', async () => {
    const { t, id } = await omar();
    ok(await t.call('usr_001', 'roles.update', { role: 'member', off: ['project.seeAll'] }));
    expect(methods(t)).toEqual(['POST', 'DELETE']);
    expect((await outboxRows(t, 'gcal.sync')).map((row) => row.payload).at(-1)).toEqual({ userId: 'usr_004', meetingId: id });
  });

  it('keeps the Google event when the role change leaves "See every project" on', async () => {
    const { t } = await omar();
    ok(await t.call('usr_001', 'roles.update', { role: 'member', off: ['chat.direct'] }));
    // The wide road checks again and puts the same event once more. It never deletes.
    expect(methods(t)).not.toContain('DELETE');
  });

  it('loses the Google event when the person moves to a role without it (users.update), and when the role is deleted with a move (roles.delete)', async () => {
    const { t } = await omar();
    const role = ok(await t.call('usr_001', 'roles.create', { name: 'Guest', nameAr: 'ضيف', rights: [], off: ['project.seeAll'] }));
    expect(methods(t)).toEqual(['POST']);
    ok(await t.call('usr_001', 'users.update', { id: 'usr_004', patch: { roleId: role.id as string } }));
    expect(methods(t)).toEqual(['POST', 'DELETE']);
    // The move back to the Member role gives the view again, and the role goes: the sync puts nothing more, because no event row stands.
    ok(await t.call('usr_001', 'roles.delete', { id: role.id as string, moveTo: 'member' }));
    expect(methods(t)).toEqual(['POST', 'DELETE']);
  });
});
