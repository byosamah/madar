import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Query } from '../core/ports';
import type { ChangeSignal } from '../core/types';
import { diffState, writeDiff } from './save';

/**
 * The change signals of a hidden project (hidden projects, owner 2026-10-22, wave D3). A project that at least one active person may
 * not view sends its changes only as person signals to the people who view it, before the change and after it. The office signal never
 * names it. With the default settings nothing changes (the last group of tests).
 *
 * The sample office: prj_001 has the leader usr_002 and the team usr_002, usr_005, usr_006 and usr_008. usr_001 is the Admin. usr_007 is on
 * other projects and becomes a chosen person. usr_003, usr_004, usr_010 (Management) and usr_011 (Accounting) are outsiders of prj_001.
 */

const TODAY = '2026-10-04';
let seed: State;
beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});

const HIDDEN = 'prj_001';
const OPEN = 'prj_002';
const ADMIN = 'usr_001';
const TEAM = ['usr_002', 'usr_005', 'usr_006', 'usr_008'];
const CHOSEN = 'usr_007';
const OUTSIDERS = ['usr_003', 'usr_004', 'usr_010', 'usr_011'];
const AT = '2026-10-04T10:00:00.000+03:00';

const copy = (): State => structuredClone(seed);
const channels = (signals: ChangeSignal[]) => signals.map((signal) => signal.channel).sort();
const people = (ids: string[]) => [...new Set(ids)].sort().map((id) => `person:${id}`);

/** The project hidden for its team, with the chosen person. */
function hide(state: State, projectId = HIDDEN, viewerIds: string[] = [CHOSEN]): State {
  state.projects[projectId] = { ...state.projects[projectId], access: { hidden: true, viewerIds } };
  return state;
}

/** A new event of the story, as a handler writes it. */
function event(state: State, fields: Partial<State['events'][string]> & { id: string }): void {
  const seq = Math.max(...Object.values(state.events).map((e) => e.seq)) + 1;
  state.events[fields.id] = {
    seq, projectId: null, actorId: 'usr_002', actorKind: 'human', actingForId: 'usr_002', correlationId: 'sty_hidden', verb: 'task.updated',
    targetType: 'task', targetId: 'tsk_001', before: null, after: null, createdAt: AT, undoneBy: null, ...fields,
  };
}

/** A change of the first task of a project, with its event. */
function taskChange(state: State, projectId: string): string {
  const task = Object.values(state.tasks).find((t) => t.projectId === projectId)!;
  state.tasks[task.id] = { ...task, title: 'Renamed in the signal test' };
  event(state, { id: `evt_9${projectId.slice(-2)}`, projectId, targetId: task.id });
  return task.id;
}

/** A fake query: it answers office_meta, person_seq and the comment lookup. */
function recorder(targets: Record<string, string> = {}) {
  const sql: { text: string; values?: unknown[] }[] = [];
  const q: Query = async <R,>(text: string, values?: unknown[]) => {
    sql.push({ text, values });
    if (text.includes('update office_meta')) {
      const [v, s] = values as number[];
      return [{ version: String(7 + v), office_seq: String(40 + s) }] as R[];
    }
    if (text.includes('insert into person_seq')) return (values![0] as string[]).map((id) => ({ user_id: id, seq: '1' })) as R[];
    if (text.includes('from tasks where id = any')) return Object.entries(targets).map(([id, projectId]) => ({ type: 'task', id, project_id: projectId })) as R[];
    return [] as R[];
  };
  return { q, sql };
}

const send = async (before: State, after: State, targets: Record<string, string> = {}) => {
  const { q, sql } = recorder(targets);
  const diff = diffState(before, after);
  const result = await writeDiff(q, diff);
  return { diff, result, signals: result.signals, sql };
};

describe('a change of a hidden project', () => {
  it('goes only as person signals to the leader, the team, the chosen person and the Admin, never on the office signal', async () => {
    const before = hide(copy());
    const after = structuredClone(before);
    taskChange(after, HIDDEN);
    const { signals, diff } = await send(before, after);
    expect(channels(signals)).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
    for (const signal of signals) {
      expect(signal.projects).toEqual([HIDDEN]);
      expect(signal.kinds).toEqual(expect.arrayContaining(['events', 'tasks']));
      expect(signal.people).toEqual([signal.channel.replace('person:', '')]);
    }
    expect(new Set(signals.map((signal) => signal.id)).size).toBe(1);
    // The outsiders hear nothing, and no text of any signal holds the project id outside the person signals of its audience.
    for (const outsider of OUTSIDERS) expect(signals.some((signal) => signal.channel === `person:${outsider}`), outsider).toBe(false);
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
    expect([...diff.projects]).toEqual([]);
    expect(diff.office).toBe(false);
  });

  it('raises no office seq for a change that only the audience hears', async () => {
    const before = hide(copy());
    const after = structuredClone(before);
    taskChange(after, HIDDEN);
    const { sql } = await send(before, after);
    expect(sql.find((s) => s.text.includes('update office_meta'))?.values?.[1] ?? 0).toBe(0);
  });

  it('sends the open part of a mixed save on the office signal, with the open project only', async () => {
    const before = hide(copy());
    const after = structuredClone(before);
    taskChange(after, HIDDEN);
    taskChange(after, OPEN);
    const { signals } = await send(before, after);
    const office = signals.find((signal) => signal.channel === 'office')!;
    expect(office.projects).toEqual([OPEN]);
    expect(JSON.stringify(office)).not.toContain(HIDDEN);
    // A person of the hidden project hears the open project on the office signal, and the hidden project on the own channel.
    const member = signals.find((signal) => signal.channel === 'person:usr_005');
    expect(member?.projects).toEqual([HIDDEN]);
    expect(member?.id).not.toBe(office.id);
    for (const signal of signals.filter((one) => one.channel !== 'office' && !TEAM.includes(one.channel.replace('person:', '')) && one.channel !== `person:${ADMIN}` && one.channel !== `person:${CHOSEN}`)) {
      expect(JSON.stringify(signal), signal.channel).not.toContain(HIDDEN);
    }
  });

  it('sends the changes of every kind of the project to its people: members, stages, deadlines, files, posts, messages and chats', async () => {
    const before = hide(copy());
    const after = structuredClone(before);
    const chat = Object.values(after.conversations).find((c) => c.projectId === HIDDEN)!;
    const stage = Object.values(after.stages).find((s) => s.projectId === HIDDEN)!;
    after.stages[stage.id] = { ...stage, name: 'Renamed stage' } as typeof stage;
    const deadline = Object.values(after.deadlines).find((d) => d.projectId === HIDDEN);
    if (deadline) after.deadlines[deadline.id] = { ...deadline, label: 'Moved deadline' } as typeof deadline;
    const message = Object.values(after.messages).find((m) => m.conversationId === chat.id)!;
    after.messages[message.id] = { ...message, body: 'Edited text' };
    const file = Object.values(after.files).find((f) => f.projectId === HIDDEN);
    if (file) after.files[file.id] = { ...file, name: 'renamed.pdf' };
    const update = Object.values(after.updates).find((u) => u.projectId === HIDDEN);
    if (update) after.updates[update.id] = { ...update, body: 'Edited post' } as typeof update;
    after.conversations[chat.id] = { ...chat, name: 'Renamed chat' } as typeof chat;
    const { signals } = await send(before, after);
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
    const kinds = new Set(signals.flatMap((signal) => signal.kinds));
    for (const kind of ['stages', 'messages', 'conversations']) expect(kinds.has(kind as never), kind).toBe(true);
    if (deadline) expect(kinds.has('deadlines')).toBe(true);
    if (file) expect(kinds.has('files')).toBe(true);
    if (update) expect(kinds.has('updates')).toBe(true);
    for (const signal of signals) {
      expect(signal.projects).toEqual([HIDDEN]);
      expect(OUTSIDERS.includes(signal.channel.replace('person:', ''))).toBe(false);
    }
    expect(channels(signals)).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
  });

  it('tells a person added to the team and a person taken off the team', async () => {
    const before = hide(copy());
    const after = structuredClone(before);
    delete after.members['prj_001:usr_008'];
    after.members['prj_001:usr_004'] = { projectId: HIDDEN, userId: 'usr_004', discipline: 'Architecture' };
    event(after, { id: 'evt_920', projectId: HIDDEN, verb: 'member.added', targetType: 'project', targetId: HIDDEN });
    const { signals } = await send(before, after);
    const heard = channels(signals);
    // usr_008 loses the view, usr_004 gains it, the others keep it.
    expect(heard).toEqual(people([ADMIN, ...TEAM, CHOSEN, 'usr_004']));
    expect(heard).toContain('person:usr_008');
    expect(heard).toContain('person:usr_004');
    for (const outsider of ['usr_003', 'usr_010', 'usr_011']) expect(heard).not.toContain(`person:${outsider}`);
  });

  it('tells a person taken off the chosen people, and a person added to them, with the people who stay', async () => {
    const before = hide(copy(), HIDDEN, [CHOSEN, 'usr_003']);
    const after = hide(structuredClone(before), HIDDEN, ['usr_003', 'usr_004']);
    event(after, { id: 'evt_921', projectId: HIDDEN, verb: 'project.access_changed', targetType: 'project', targetId: HIDDEN });
    const { signals } = await send(before, after);
    expect(channels(signals)).toEqual(people([ADMIN, ...TEAM, CHOSEN, 'usr_003', 'usr_004']));
    expect(signals.some((signal) => signal.channel === `person:usr_010`)).toBe(false);
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
  });

  it('tells the whole office, on person signals only, when an open project becomes hidden', async () => {
    const before = copy();
    const after = hide(structuredClone(before));
    event(after, { id: 'evt_922', projectId: HIDDEN, verb: 'project.access_changed', targetType: 'project', targetId: HIDDEN });
    const { signals } = await send(before, after);
    const everyone = Object.values(seed.users).filter((u) => u.kind === 'human' && u.active).map((u) => u.id);
    expect(channels(signals)).toEqual(people(everyone));
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
    for (const signal of signals) expect(signal.projects).toEqual([HIDDEN]);
  });

  it('tells the whole office, on person signals only, when a hidden project becomes open', async () => {
    const before = hide(copy());
    const after = structuredClone(before);
    after.projects[HIDDEN] = { ...after.projects[HIDDEN], access: { hidden: false, viewerIds: [] } };
    event(after, { id: 'evt_923', projectId: HIDDEN, verb: 'project.access_changed', targetType: 'project', targetId: HIDDEN });
    const { signals } = await send(before, after);
    const everyone = Object.values(seed.users).filter((u) => u.kind === 'human' && u.active).map((u) => u.id);
    expect(channels(signals)).toEqual(people(everyone));
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
  });

  it('sends the delete of a hidden project to the people who saw it', async () => {
    const before = hide(copy());
    const after = structuredClone(before);
    delete after.projects[HIDDEN];
    for (const [key, member] of Object.entries(after.members)) if (member.projectId === HIDDEN) delete after.members[key];
    event(after, { id: 'evt_924', projectId: HIDDEN, verb: 'project.deleted', targetType: 'project', targetId: HIDDEN });
    const { signals } = await send(before, after);
    expect(channels(signals)).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
  });

  it('does not tell an inactive person, and names no agent', async () => {
    const before = hide(copy());
    before.users.usr_006 = { ...before.users.usr_006, active: false };
    const after = structuredClone(before);
    taskChange(after, HIDDEN);
    const { signals } = await send(before, after);
    expect(channels(signals)).toEqual(people([ADMIN, 'usr_002', 'usr_005', 'usr_008', CHOSEN]));
    expect(channels(signals)).not.toContain('person:usr_009');
  });

  it('keeps the person signal of a notice inside the part of its project, so the owner of the notice hears the kinds of the project once', async () => {
    const before = hide(copy());
    const after = structuredClone(before);
    const taskId = taskChange(after, HIDDEN);
    after.notifications.ntf_960 = {
      id: 'ntf_960', userId: 'usr_005', trigger: 'task_assigned', actorId: 'usr_002', targetType: 'task', targetId: taskId, read: false, createdAt: AT, dedupeKey: null,
    };
    const { signals } = await send(before, after);
    expect(channels(signals)).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
    const owner = signals.filter((signal) => signal.channel === 'person:usr_005');
    expect(owner).toHaveLength(1);
    expect(owner[0].kinds).toEqual(expect.arrayContaining(['events', 'notifications', 'tasks']));
    expect(owner[0].projects).toEqual([HIDDEN]);
  });
});

describe('a role without "See every project"', () => {
  /** The Member role turns "See every project" off: a Member sees only the projects where the person works. */
  function noSeeAll(state: State): State {
    state.settings = { ...state.settings, roles: { ...state.settings.roles, off: { member: ['project.seeAll'] } } };
    return state;
  }

  it('hears the change of an open project only as a person of that project, and the office signal never names it', async () => {
    const before = noSeeAll(copy());
    const after = structuredClone(before);
    taskChange(after, HIDDEN);
    const { signals } = await send(before, after);
    // The Admin, Management and Accounting keep "See every project". The Members who work on the project hear it.
    expect(channels(signals)).toEqual(people([ADMIN, 'usr_010', 'usr_011', ...TEAM]));
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
    for (const outsider of ['usr_003', 'usr_004', CHOSEN]) expect(channels(signals)).not.toContain(`person:${outsider}`);
  });
});

describe('a comment whose target the call did not load', () => {
  it('goes to the people of the project when the lookup finds a hidden project, and to the office when it finds an open one', async () => {
    const hidden = hide(copy());
    const after = structuredClone(hidden);
    after.comments.cmt_990 = { ...Object.values(after.comments)[0], id: 'cmt_990', targetType: 'task', targetId: 'tsk_far' };
    const found = await send(hidden, after, { tsk_far: HIDDEN });
    expect(channels(found.signals)).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
    expect([...found.result.projects]).toEqual([]);
    expect(found.signals.some((signal) => signal.channel === 'office')).toBe(false);
    const open = await send(hidden, after, { tsk_far: OPEN });
    expect(open.signals.map((signal) => signal.channel)).toContain('office');
    expect([...open.result.projects]).toEqual([OPEN]);
  });
});

describe('with the default settings', () => {
  it('sends a change of a project on the office signal, as before', async () => {
    const before = copy();
    const after = structuredClone(before);
    taskChange(after, HIDDEN);
    const { signals, diff } = await send(before, after);
    expect(signals.map((signal) => signal.channel)).toEqual(['office']);
    expect(signals[0].projects).toEqual([HIDDEN]);
    expect([...diff.projects]).toEqual([HIDDEN]);
  });
});
