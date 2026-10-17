import { beforeAll, describe, expect, it } from 'vitest';
import { calls } from '../../src/api/calls';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { testApi } from '../../src/test/factories';
import type { Query } from '../core/ports';
import { deepFreeze } from './officeCache';
import { diffState, save, writeDiff, type Diff } from './save';

/**
 * The diff writer without a database (plan 4.8; task C1). diffState is pure. writeDiff runs here on a fake query that records each
 * statement; server/it/save.it.test.ts runs the same code on the local stack.
 */

const TODAY = '2026-10-04';
let seed: State;
beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});

const copy = (): State => structuredClone(seed);
const table = (diff: Diff, name: string) => diff.tables.find((change) => change.spec.table === name);
const sorted = (set: Set<string>) => [...set].sort();

/** A new event of the story, as a handler writes it (src/api/events.ts writeEvent). */
function event(state: State, fields: Partial<State['events'][string]> & { id: string }): State['events'][string] {
  const seq = Math.max(...Object.values(state.events).map((e) => e.seq)) + 1;
  const made = {
    seq, projectId: null, actorId: 'usr_002', actorKind: 'human' as const, actingForId: 'usr_002', correlationId: 'sty_story', verb: 'task.updated',
    targetType: 'task' as const, targetId: 'tsk_001', before: null, after: null, createdAt: '2026-10-04T10:00:00.000+03:00', undoneBy: null, ...fields,
  };
  state.events[made.id] = made;
  return made;
}

describe('diffState', () => {
  it('finds no change in a copy, and ignores session, version, seededOn and counts', () => {
    const after = copy();
    after.session.currentUserId = 'usr_003';
    after.version += 1;
    after.seededOn = '2027-01-01';
    after.counts = { 'comments:tsk_001': 4 };
    const diff = diffState(seed, after);
    expect(diff.tables).toEqual([]);
    expect(diff.counters).toEqual({});
    expect(diff.kinds.size).toBe(0);
  });

  it('inserts, updates and deletes by key, and names the kind and the project', () => {
    const after = copy();
    const [first, second] = Object.values(after.tasks);
    after.tasks.tsk_900 = { ...first, id: 'tsk_900', title: 'New task' };
    second.title = 'Renamed';
    delete after.tasks[first.id];
    const change = table(diffState(seed, after), 'tasks')!;
    expect(change.inserted).toEqual(['tsk_900']);
    expect(change.updated).toEqual([second.id]);
    expect(change.deleted).toEqual([first.id]);
    const diff = diffState(seed, after);
    expect(sorted(diff.kinds)).toEqual(['tasks']);
    expect(sorted(diff.projects)).toEqual([...new Set([first.projectId, second.projectId])].sort());
    expect(diff.office).toBe(false);
  });

  it('writes the rows in the key order of the State after the call, so ord follows the prototype order', () => {
    const after = copy();
    const keys = Object.keys(after.tasks);
    const base = after.tasks[keys[0]];
    after.tasks.tsk_901 = { ...base, id: 'tsk_901' };
    after.tasks[keys[5]].title = 'Changed in the middle';
    after.tasks.tsk_902 = { ...base, id: 'tsk_902' };
    const change = table(diffState(seed, after), 'tasks')!;
    expect(change.upserts.map((row) => row.id)).toEqual([keys[5], 'tsk_901', 'tsk_902']);
  });

  it('counts a change in the key order of a record as no change', () => {
    const after = copy();
    const task = Object.values(after.tasks)[0];
    after.tasks[task.id] = Object.fromEntries(Object.entries(task).reverse()) as typeof task;
    expect(diffState(seed, after).tables).toEqual([]);
  });

  it('writes the server columns: search text and the project of a comment from its target', () => {
    const after = copy();
    const task = Object.values(after.tasks)[0];
    task.title = 'Floor  PLANS';
    const comment = Object.values(after.comments).find((c) => c.targetType === 'task')!;
    comment.body = 'Edited';
    const diff = diffState(seed, after);
    expect(table(diff, 'tasks')!.upserts[0].columns).toEqual({ search_text: 'floor plans' });
    expect(table(diff, 'comments')!.upserts[0].columns).toEqual({ project_id: after.tasks[comment.targetId].projectId });
    expect(diff.projects.has(after.tasks[comment.targetId].projectId!)).toBe(true);
    expect(diff.unresolvedComments).toEqual([]);
  });

  it('leaves the project of a comment whose target the call did not load for writeDiff to look up', () => {
    const after = copy();
    after.comments.cmt_900 = { ...Object.values(after.comments)[0], id: 'cmt_900', targetType: 'task', targetId: 'tsk_not_loaded' };
    const diff = diffState(seed, after);
    expect(diff.unresolvedComments).toEqual([{ id: 'cmt_900', targetType: 'task', targetId: 'tsk_not_loaded' }]);
    expect(table(diff, 'comments')!.upserts[0].columns).toEqual({ project_id: null });
  });

  it('upserts only the changed counters', () => {
    const after = copy();
    after.counters.tsk = (after.counters.tsk ?? 0) + 1;
    after.counters.zzz = 1;
    expect(diffState(seed, after).counters).toEqual({ tsk: after.counters.tsk, zzz: 1 });
  });
});

describe('diffState on a frozen before (performance audit SRV-8, DB-7)', () => {
  const text = (d: Diff) => JSON.stringify({ ...d, tables: d.tables.map((c) => ({ ...c, spec: c.spec.table })) }, (_k, v) => (v instanceof Set ? [...v].sort() : v));

  it('gives the same Diff with a deep-frozen before as with a copy, also the second time, and never writes into before', () => {
    const before = deepFreeze(copy());
    const after = copy();
    const [first, second] = Object.values(after.tasks);
    second.title = 'Renamed';
    delete after.tasks[first.id];
    after.members[Object.keys(after.members)[0]].discipline = 'Interiors';
    after.users.usr_005.name = 'A new name';
    after.clients.cli_900 = { ...Object.values(after.clients)[0], id: 'cli_900', name: 'New client' };
    const want = text(diffState(copy(), after));
    expect(text(diffState(before, after))).toBe(want);
    expect(text(diffState(before, after))).toBe(want);
    expect(text(diffState(before, copy()))).toBe(text(diffState(copy(), copy())));
  });

  it('compares a record that is frozen only on top by its JSON of now, so a later change inside it still counts', () => {
    const before = copy();
    const user = { ...before.users.usr_005, preferences: { ...before.users.usr_005.preferences } };
    before.users.usr_005 = Object.freeze(user) as never;
    const after = copy();
    expect(table(diffState(before, after), 'users')).toBeUndefined();
    (user.preferences as { language: string }).language = user.preferences.language === 'ar' ? 'en' : 'ar';
    expect(table(diffState(before, after), 'users')?.updated).toEqual(['usr_005']);
  });
});

describe('diffState and the events', () => {
  it('inserts a new event and stores undoneBy as null, because the loader fills it (plan 4.3)', () => {
    const after = copy();
    event(after, { id: 'evt_900' });
    const change = table(diffState(seed, after), 'events')!;
    expect(change.inserted).toEqual(['evt_900']);
    expect(change.upserts[0].doc.undoneBy).toBeNull();
  });

  it('fails when an old event changes or goes', () => {
    const changed = copy();
    Object.values(changed.events)[0].verb = 'task.forged';
    expect(() => diffState(seed, changed)).toThrow(/History only grows/);
    const gone = copy();
    delete gone.events[Object.keys(gone.events)[0]];
    expect(() => diffState(seed, gone)).toThrow(/History only grows/);
  });

  it('accepts undoneBy on an old event only when the same save inserts the undo event that names it', () => {
    const ok = copy();
    const x = Object.values(ok.events)[0];
    const y = event(ok, { id: 'evt_901', verb: 'undo', undoes: x.id });
    x.undoneBy = y.id;
    const diff = diffState(seed, ok);
    expect(table(diff, 'events')!.inserted).toEqual(['evt_901']);
    expect(table(diff, 'events')!.updated).toEqual([]);

    const noUndo = copy();
    Object.values(noUndo.events)[0].undoneBy = 'evt_901';
    expect(() => diffState(seed, noUndo)).toThrow(/undoneBy/);

    const wrongTarget = copy();
    const [a, b] = Object.values(wrongTarget.events);
    event(wrongTarget, { id: 'evt_902', verb: 'undo', undoes: b.id });
    a.undoneBy = 'evt_902';
    expect(() => diffState(seed, wrongTarget)).toThrow(/undoneBy/);

    // An old undo event (one a loader brought in without filling undoneBy on its target) does not count: the undo must be new.
    const before = copy();
    const target = Object.values(before.events)[0];
    event(before, { id: 'evt_904', verb: 'undo', undoes: target.id });
    const oldUndo = structuredClone(before);
    oldUndo.events[target.id].undoneBy = 'evt_904';
    expect(() => diffState(before, oldUndo)).toThrow(/undoneBy/);
  });

  it('fails when a new event carries an undoneBy that no undo event in the State names', () => {
    const after = copy();
    event(after, { id: 'evt_903', undoneBy: 'evt_999' });
    expect(() => diffState(seed, after)).toThrow(/undoneBy/);
  });
});

describe('diffState kinds, people and the office', () => {
  it('names projectTouched when the only project change is updatedAt, and projects for any other change', () => {
    const touched = copy();
    const project = Object.values(touched.projects)[0];
    project.updatedAt = '2026-10-04T10:00:00.000+03:00';
    const diff = diffState(seed, touched);
    expect(sorted(diff.kinds)).toEqual(['projectTouched']);
    expect(sorted(diff.projects)).toEqual([project.id]);
    expect(diff.officeRows).toBe(true);

    const renamed = copy();
    Object.values(renamed.projects)[0].name = 'Another name';
    expect(sorted(diffState(seed, renamed).kinds)).toEqual(['projects']);
  });

  it('names preferences, not users, for a change of own preferences, with its event, and keeps it personal', () => {
    const after = copy();
    const user = Object.values(after.users).find((u) => u.kind === 'human')!;
    user.preferences = { ...user.preferences, theme: 'dark' };
    event(after, { id: 'evt_904', verb: 'user.preferences_changed', targetType: 'user', targetId: user.id });
    const diff = diffState(seed, after);
    expect(sorted(diff.kinds)).toEqual(['preferences']);
    expect(sorted(diff.people)).toEqual([user.id]);
    expect(diff.personal).toBe(true);
    expect(diff.office).toBe(false);
    // The users row still changes, so the office cache must load it again.
    expect(diff.officeRows).toBe(true);
  });

  it('names users and the office for a profile change', () => {
    const after = copy();
    const user = Object.values(after.users)[0];
    user.name = 'New Name';
    event(after, { id: 'evt_905', verb: 'user.profile_changed', targetType: 'user', targetId: user.id });
    const diff = diffState(seed, after);
    expect(sorted(diff.kinds)).toEqual(['events', 'users']);
    expect(diff.office).toBe(true);
    expect(diff.personal).toBe(false);
    expect(diff.people.size).toBe(0);
  });

  it('keeps a read mark and a notice change personal: people only, no office signal', () => {
    const after = copy();
    const read = Object.values(after.chatReads)[0];
    read.lastReadAt = '2026-10-04T11:00:00.000+03:00';
    const notice = Object.values(after.notifications).find((n) => !n.read)!;
    notice.read = true;
    const diff = diffState(seed, after);
    expect(sorted(diff.kinds)).toEqual(['chatReads', 'notifications']);
    expect(sorted(diff.people)).toEqual([...new Set([read.userId, notice.userId])].sort());
    expect(diff.personal).toBe(true);
    expect(diff.projects.size).toBe(0);
    expect(diff.office).toBe(false);
    expect(diff.officeRows).toBe(false);
  });

  it('marks a mixed change as not personal, with the people of its notices', () => {
    const after = copy();
    const task = Object.values(after.tasks)[0];
    task.ownerId = 'usr_005';
    const notice = { ...Object.values(after.notifications)[0], id: 'ntf_900', userId: 'usr_005', read: false };
    after.notifications[notice.id] = notice;
    const diff = diffState(seed, after);
    expect(sorted(diff.kinds)).toEqual(['notifications', 'tasks']);
    expect(sorted(diff.people)).toEqual(['usr_005']);
    expect(diff.personal).toBe(false);
  });

  it('names the office for records with no project: clients, a direct chat and its messages', () => {
    const client = copy();
    Object.values(client.clients)[0].name = 'Other';
    expect(diffState(seed, client).office).toBe(true);
    expect(diffState(seed, client).projects.size).toBe(0);

    const direct = copy();
    direct.conversations.cnv_900 = { id: 'cnv_900', kind: 'direct', projectId: null, memberIds: ['usr_002', 'usr_003'], createdAt: '2026-10-04T10:00:00.000+03:00' } as State['conversations'][string];
    direct.messages.msg_900 = { ...Object.values(direct.messages)[0], id: 'msg_900', conversationId: 'cnv_900' };
    const diff = diffState(seed, direct);
    expect(diff.office).toBe(true);
    expect(diff.projects.size).toBe(0);
  });

  it('names the project of a message in a project chat', () => {
    const after = copy();
    const message = Object.values(after.messages)[0];
    message.body = 'Edited';
    const diff = diffState(seed, after);
    expect(sorted(diff.projects)).toEqual([after.conversations[message.conversationId].projectId as string]);
    expect(diff.office).toBe(false);
  });

  it('marks officeRows only for a change of an office table, and lists office deletes', () => {
    const task = copy();
    Object.values(task.tasks)[0].title = 'x';
    expect(diffState(seed, task).officeRows).toBe(false);
    const gone = copy();
    const client = Object.values(gone.clients)[0];
    delete gone.clients[client.id];
    const diff = diffState(seed, gone);
    expect(diff.officeRows).toBe(true);
    expect(table(diff, 'clients')!.deleted).toEqual([client.id]);
  });

  it('takes the story and actor of the signals from the first new event', () => {
    const after = copy();
    event(after, { id: 'evt_906', correlationId: 'sty_abc', actorId: 'usr_007' });
    expect(diffState(seed, after).meta).toEqual({ storyId: 'sty_abc', actorId: 'usr_007' });
  });
});

/** A fake query: it records each statement, and answers office_meta, person_seq and the comment lookup. */
function recorder(o: { version?: number; officeSeq?: number; personSeq?: Record<string, number>; targets?: Record<string, string> } = {}) {
  const sql: { text: string; values?: unknown[] }[] = [];
  const q: Query = async <R,>(text: string, values?: unknown[]) => {
    sql.push({ text, values });
    if (text.includes('update office_meta')) {
      const [v, s] = values as number[];
      return [{ version: String((o.version ?? 7) + v), office_seq: String((o.officeSeq ?? 40) + s) }] as R[];
    }
    if (text.includes('insert into person_seq')) {
      return ((values![0] as string[]).map((id) => ({ user_id: id, seq: String(o.personSeq?.[id] ?? 1) }))) as R[];
    }
    if (text.includes('from tasks where id = any')) {
      return Object.entries(o.targets ?? {}).map(([id, projectId]) => ({ type: 'task', id, project_id: projectId })) as R[];
    }
    return [] as R[];
  };
  return { q, sql };
}

describe('the signals of an office task (review 2026-10-06)', () => {
  /** An office task that usr_004 made, that usr_005 leads and usr_006 helps on, with the event of its change. */
  function officeChange(state: State = copy()): State {
    const first = Object.values(state.tasks)[0];
    state.tasks.tsk_900 = {
      ...first, id: 'tsk_900', projectId: null, stageId: null, title: 'Renew the trade licence', createdBy: 'usr_004', ownerId: 'usr_005', helperIds: ['usr_006'],
    };
    event(state, { id: 'evt_950', correlationId: 'sty_office', actorId: 'usr_004', verb: 'task.created', targetId: 'tsk_900', officeTaskId: 'tsk_900' });
    return state;
  }
  const admins = () => Object.values(seed.users).filter((u) => u.kind === 'human' && u.active && u.systemRole === 'admin').map((u) => u.id);
  const personChannels = (ids: string[]) => [...new Set(ids)].sort().map((id) => `person:${id}`);

  it('sends a change of an office task only to its people and the Admins, with no office signal and no names', async () => {
    const after = officeChange();
    after.notifications.ntf_950 = {
      id: 'ntf_950', userId: 'usr_005', trigger: 'task_assigned', actorId: 'usr_004', targetType: 'task', targetId: 'tsk_900', read: false,
      createdAt: '2026-10-04T10:00:00.000+03:00', dedupeKey: null,
    };
    const { q, sql } = recorder();
    const result = await writeDiff(q, diffState(seed, after));
    expect(result.signals.map((signal) => signal.channel).sort()).toEqual(personChannels(['usr_004', 'usr_005', 'usr_006', ...admins()]));
    for (const signal of result.signals) {
      expect(signal).not.toHaveProperty('actorId');
      expect(signal).not.toHaveProperty('storyId');
      expect(signal).toMatchObject({ office: false, projects: [], people: [signal.channel.slice('person:'.length)] });
    }
    // No office seq: the office channel hears nothing of it.
    expect(sql.find((s) => s.text.includes('update office_meta'))?.values?.[1] ?? 0).toBe(0);
  });

  it('sends a comment of an office task only to the people of the task, with no lookup of its project', async () => {
    const before = officeChange();
    const after = structuredClone(before);
    after.comments.cmt_950 = {
      id: 'cmt_950', targetType: 'task', targetId: 'tsk_900', authorId: 'usr_005', body: 'Paid', reactions: { '👍': [], '✅': [], '👀': [] }, fileIds: [],
      createdAt: '2026-10-04T10:00:00.000+03:00', editedAt: null,
    };
    event(after, { id: 'evt_951', correlationId: 'sty_office', actorId: 'usr_005', verb: 'comment.created', targetType: 'comment', targetId: 'cmt_950', officeTaskId: 'tsk_900' });
    const { q, sql } = recorder();
    const result = await writeDiff(q, diffState(before, after));
    expect(result.signals.map((signal) => signal.channel).sort()).toEqual(personChannels(['usr_004', 'usr_005', 'usr_006', ...admins()]));
    expect(sql.some((s) => s.text.includes('from tasks where id = any'))).toBe(false);
  });

  it('sends the Undo of a comment of a deleted office task to the Admins only, with no office signal', async () => {
    const before = copy();
    before.comments.cmt_952 = {
      id: 'cmt_952', targetType: 'task', targetId: 'tsk_901', authorId: 'usr_005', body: 'Paid', reactions: { '👍': [], '✅': [], '👀': [] }, fileIds: [],
      createdAt: '2026-10-04T10:00:00.000+03:00', editedAt: null,
    };
    const after = structuredClone(before);
    delete after.comments.cmt_952;
    event(after, { id: 'evt_952', correlationId: 'sty_office', actorId: 'usr_005', verb: 'undo', targetType: 'comment', targetId: 'cmt_952', officeTaskId: 'tsk_901' });
    const { q } = recorder();
    const result = await writeDiff(q, diffState(before, after));
    expect(result.signals.map((signal) => signal.channel).sort()).toEqual(personChannels(admins()));
  });

  it('in a save with a project part and an office part, the office signal tells only the project part, with its names', async () => {
    const before = officeChange();
    const after = structuredClone(before);
    const project = Object.values(after.tasks).find((t) => t.projectId !== null)!;
    project.title = 'Renamed';
    event(after, { id: 'evt_953', correlationId: 'sty_mixed', actorId: 'usr_005', verb: 'task.updated', targetId: project.id, projectId: project.projectId });
    // The office part: a comment of the office task, and its notice to Nour.
    after.comments.cmt_953 = {
      id: 'cmt_953', targetType: 'task', targetId: 'tsk_900', authorId: 'usr_005', body: 'Paid', reactions: { '👍': [], '✅': [], '👀': [] }, fileIds: [],
      createdAt: '2026-10-04T10:00:00.000+03:00', editedAt: null,
    };
    event(after, { id: 'evt_954', correlationId: 'sty_mixed', actorId: 'usr_005', verb: 'comment.created', targetType: 'comment', targetId: 'cmt_953', officeTaskId: 'tsk_900' });
    after.notifications.ntf_953 = {
      id: 'ntf_953', userId: 'usr_006', trigger: 'mention', actorId: 'usr_005', targetType: 'task', targetId: 'tsk_900', read: false,
      createdAt: '2026-10-04T10:00:00.000+03:00', dedupeKey: null,
    };
    const { q } = recorder();
    const result = await writeDiff(q, diffState(before, after));
    const office = result.signals.find((signal) => signal.channel === 'office')!;
    expect(office).toMatchObject({ actorId: 'usr_005', storyId: 'sty_mixed', projects: [project.projectId], kinds: ['events', 'tasks'], office: false });
    // The people of the office task hear the office part on their own channel, under another id and with no names.
    const nour = result.signals.find((signal) => signal.channel === 'person:usr_006')!;
    expect(nour.id).not.toBe(office.id);
    expect(nour).not.toHaveProperty('actorId');
    expect(nour.kinds).toEqual(expect.arrayContaining(['comments', 'notifications']));
    expect(result.signals.map((signal) => signal.channel).sort()).toEqual(['office', ...personChannels(['usr_004', 'usr_005', 'usr_006', ...admins()])].sort());
  });

  it('keeps the actor and the story on the signal of a project change', async () => {
    const after = copy();
    Object.values(after.tasks)[0].title = 'Renamed';
    event(after, { id: 'evt_952', correlationId: 'sty_project', actorId: 'usr_002' });
    const { q } = recorder();
    const result = await writeDiff(q, diffState(seed, after));
    for (const signal of result.signals) expect(signal).toMatchObject({ actorId: 'usr_002', storyId: 'sty_project' });
  });
});

/**
 * The signals of requests and bugs (spec 2026-10-07, section 6, rows 10 and 11): the handlers run on the sample office, Hala
 * (usr_001) and Faisal (usr_002) are Admins, and Reem (usr_003) sends a bug report.
 */
describe('the signals of requests and bugs', () => {
  const MESSAGE = 'The board does not scroll on my phone.';
  async function sent() {
    const state = copy();
    state.users.usr_002.systemRole = 'admin';
    const before = structuredClone(state);
    const t = testApi(calls, state);
    t.as('usr_003');
    const report = await t.api.call('feedback.send', { kind: 'bug', message: MESSAGE, page: '/projects', screenshots: [] });
    return { t, before, report };
  }

  it('sends a new report to the office with no ids and no words, and to each Admin on their own channel only', async () => {
    const { t, before, report } = await sent();
    const { q } = recorder();
    const result = await writeDiff(q, diffState(before, t.store.state));
    expect(result.signals.map((signal) => signal.channel).sort()).toEqual(['office', 'person:usr_001', 'person:usr_002']);
    const office = result.signals.find((signal) => signal.channel === 'office')!;
    expect(office).toMatchObject({ kinds: ['events', 'feedback', 'notifications'], actorId: 'usr_003', people: [] });
    expect(office.storyId).toEqual(expect.any(String));
    const json = JSON.stringify(result.signals);
    expect(json).not.toContain(report.id);
    expect(json).not.toContain(MESSAGE.slice(0, 20));
  });

  it('sends a done report to the sender on her own channel', async () => {
    const { t, report } = await sent();
    const before = structuredClone(t.store.state);
    t.as('usr_001');
    await t.api.call('feedback.setStatus', { id: report.id, status: 'done' });
    const { q } = recorder();
    const result = await writeDiff(q, diffState(before, t.store.state));
    expect(result.signals.map((signal) => signal.channel).sort()).toEqual(['office', 'person:usr_003']);
    const json = JSON.stringify(result.signals);
    expect(json).not.toContain(report.id);
    expect(json).not.toContain(MESSAGE.slice(0, 20));
  });
});

describe('push devices (owner, 2026-10-08)', () => {
  const device = { id: 'pdv_001', userId: 'usr_003', endpoint: 'https://fcm.googleapis.com/fcm/send/x', label: 'Chrome on Mac', createdAt: '2026-10-04T10:00:00.000+03:00', lastPushAt: null };

  it('writes the row of a device but names no kind, no project, no person and no office change', () => {
    const after = copy();
    after.pushDevices = { pdv_001: device };
    const diff = diffState(seed, after);
    expect(table(diff, 'push_devices')?.inserted).toEqual(['pdv_001']);
    expect(diff.kinds.size).toBe(0);
    expect(diff.publicKinds.size).toBe(0);
    expect(diff.projects.size).toBe(0);
    expect(diff.people.size).toBe(0);
    expect(diff.office).toBe(false);
    expect(diff.privateChange).toBe(false);
  });

  it('sends no signal for a device: not on the office channel and not on a person channel, and it raises no office seq', async () => {
    const before = copy();
    before.pushDevices = { pdv_001: device };
    const after = structuredClone(before);
    after.pushDevices!.pdv_002 = { ...device, id: 'pdv_002', endpoint: 'https://fcm.googleapis.com/fcm/send/y' };
    after.pushDevices!.pdv_001.label = 'Chrome on Windows';
    const { q, sql } = recorder();
    const result = await save(q, before, after, { story: { storyId: 'sty_x', actorId: 'usr_003' } });
    expect(result.changed).toBe(true);
    expect(result.signals).toEqual([]);
    expect(result.kinds.size).toBe(0);
    expect(sql.some((s) => s.text.includes('update office_meta') || s.text.includes('person_seq'))).toBe(false);
    expect(sql.find((s) => s.text.startsWith('insert into push_devices'))!.text).toContain('on conflict (id) do update');
  });

  it('deletes a device by key, with no signal', async () => {
    const before = copy();
    before.pushDevices = { pdv_001: device };
    const after = structuredClone(before);
    delete after.pushDevices!.pdv_001;
    const { q, sql } = recorder();
    const result = await save(q, before, after);
    expect(sql.find((s) => s.text.startsWith('delete from push_devices'))!.values).toEqual([['pdv_001']]);
    expect(result.signals).toEqual([]);
  });
});

describe('the new messages of a save (the push producer reads them)', () => {
  it('lists the ids of the messages that the save inserted, and leaves the list out when there are none', async () => {
    const after = copy();
    const message = Object.values(after.messages)[0];
    after.messages.msg_901 = { ...message, id: 'msg_901' };
    after.messages.msg_902 = { ...message, id: 'msg_902' };
    const { q } = recorder();
    expect((await save(q, seed, after)).messageIds).toEqual(['msg_901', 'msg_902']);
    const edited = copy();
    Object.values(edited.messages)[0].body = 'Edited';
    expect((await save(recorder().q, seed, edited)).messageIds).toBeUndefined();
    expect(diffState(seed, edited).messageIds).toEqual([]);
  });
});

describe('the new notices of a save (the mail and push producers on SQLite read them)', () => {
  it('lists the ids of the notices that the save inserted, and leaves the list out when there are none', async () => {
    const after = copy();
    const notice = Object.values(after.notifications)[0];
    after.notifications.ntf_901 = { ...notice, id: 'ntf_901', read: false };
    after.notifications.ntf_902 = { ...notice, id: 'ntf_902', read: false };
    expect((await save(recorder().q, seed, after)).noticeIds).toEqual(['ntf_901', 'ntf_902']);
    const edited = copy();
    Object.values(edited.notifications)[0].read = true;
    expect((await save(recorder().q, seed, edited)).noticeIds).toBeUndefined();
    expect(diffState(seed, edited).noticeIds).toEqual([]);
  });
});

describe('writeDiff', () => {
  it('writes nothing and sends no signal for no change', async () => {
    const { q, sql } = recorder();
    const result = await save(q, seed, copy());
    expect(result).toMatchObject({ changed: false, signals: [], bytesWritten: 0 });
    expect(sql).toEqual([]);
  });

  it('raises the office version and the office seq once, sets chg on office rows, and ends with the constraint check', async () => {
    const after = copy();
    const client = Object.values(after.clients)[0];
    client.name = 'Other';
    const gone = Object.values(after.teams ?? {})[0];
    if (gone) delete after.teams![gone.id];
    event(after, { id: 'evt_907', correlationId: 'sty_x', actorId: 'usr_002' });
    const { q, sql } = recorder({ version: 7, officeSeq: 40 });
    const result = await writeDiff(q, diffState(seed, after));
    expect(sql[0].text).toContain('update office_meta');
    expect(sql[0].values).toEqual([1, 1]);
    expect(result.officeVersion).toBe(8);
    const upsert = sql.find((s) => s.text.startsWith('insert into clients'))!;
    expect(upsert.text).toContain('chg = excluded.chg');
    expect(upsert.values![1]).toBe(8);
    if (gone) {
      const deletes = sql.find((s) => s.text.startsWith('insert into office_deletes'))!;
      expect(deletes.values).toEqual(['teams', [gone.id], 8]);
    }
    const events = sql.find((s) => s.text.startsWith('insert into events'))!;
    expect(events.text).not.toContain('on conflict');
    expect(sql.at(-1)!.text).toBe('set constraints all immediate');
    expect(result.signals).toEqual([
      { v: 1, id: expect.any(String), channel: 'office', seq: 41, projects: [], office: true, kinds: ['clients', 'events', ...(gone ? ['teams'] : [])].sort(), people: [], storyId: 'sty_x', actorId: 'usr_002' },
    ]);
    expect(result.bytesWritten).toBeGreaterThan(0);
  });

  it('raises no office version for a change of a non-office table, but still the office seq', async () => {
    const after = copy();
    Object.values(after.tasks)[0].title = 'x';
    const { q, sql } = recorder();
    const result = await writeDiff(q, diffState(seed, after), { story: { storyId: 'sty_t', actorId: 'usr_003' } });
    expect(sql[0].values).toEqual([0, 1]);
    expect(result.officeVersion).toBeUndefined();
    expect(sql.find((s) => s.text.startsWith('insert into tasks'))!.text).not.toContain('chg');
    expect(result.signals.map((s) => [s.channel, s.storyId, s.actorId])).toEqual([['office', 'sty_t', 'usr_003']]);
  });

  it('sends a personal change only on the person channels, each with its own seq, and the same id', async () => {
    const after = copy();
    const reads = Object.values(after.chatReads);
    const a = reads[0];
    const b = reads.find((r) => r.userId !== a.userId)!;
    a.lastReadAt = '2026-10-04T11:00:00.000+03:00';
    b.lastReadAt = '2026-10-04T11:00:00.000+03:00';
    const { q, sql } = recorder({ personSeq: { [a.userId]: 5, [b.userId]: 9 } });
    const result = await writeDiff(q, diffState(seed, after), { story: { storyId: 'sty_r', actorId: a.userId } });
    expect(sql.some((s) => s.text.includes('update office_meta'))).toBe(false);
    expect(result.signals.map((s) => [s.channel, s.seq, s.people])).toEqual(
      [[`person:${a.userId}`, 5, [a.userId]], [`person:${b.userId}`, 9, [b.userId]]].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    expect(new Set(result.signals.map((s) => s.id)).size).toBe(1);
    expect(result.signals.every((s) => s.office === false && s.kinds.join() === 'chatReads')).toBe(true);
  });

  it('sends a mixed change on the office channel without names, and on the channel of each person in it', async () => {
    const after = copy();
    Object.values(after.tasks)[0].ownerId = 'usr_005';
    after.notifications.ntf_901 = { ...Object.values(after.notifications)[0], id: 'ntf_901', userId: 'usr_005', read: false };
    const { q } = recorder({ officeSeq: 10, personSeq: { usr_005: 3 } });
    const result = await writeDiff(q, diffState(seed, after), { story: { storyId: 's', actorId: 'usr_002' } });
    expect(result.signals.map((s) => [s.channel, s.seq, s.people])).toEqual([['office', 11, []], ['person:usr_005', 3, ['usr_005']]]);
    expect(result.signals[0].kinds).toEqual(result.signals[1].kinds);
    expect(result.signals[0].id).toBe(result.signals[1].id);
  });

  it('looks up the project of a comment whose target the call did not load, with one query', async () => {
    const after = copy();
    after.comments.cmt_901 = { ...Object.values(after.comments)[0], id: 'cmt_901', targetType: 'task', targetId: 'tsk_far' };
    const { q, sql } = recorder({ targets: { tsk_far: 'prj_far' } });
    const result = await writeDiff(q, diffState(seed, after), { story: { storyId: 's', actorId: 'usr_002' } });
    const upsert = sql.find((s) => s.text.startsWith('insert into comments'))!;
    expect(JSON.parse(upsert.values![0] as string)[0].project_id).toBe('prj_far');
    expect([...result.projects]).toEqual(['prj_far']);
    expect(result.office).toBe(false);
  });

  it('writes no signal and no seq when signals are off (writeState)', async () => {
    const after = copy();
    Object.values(after.clients)[0].name = 'Other';
    const { q, sql } = recorder();
    const result = await writeDiff(q, diffState(seed, after), { signals: false });
    expect(sql[0].values).toEqual([1, 0]);
    expect(result.signals).toEqual([]);
    expect(result.changed).toBe(true);
  });
});
