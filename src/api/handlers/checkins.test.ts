import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { OfficeRight } from '../contract/entities';
import { checkinsOf, memberKey } from '../store';
import { makeTask, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

/** Sunday 2026-11-08 at 09:00 in the office. The question of that week is the plan; Thursday 2026-11-12 asks for the review. */
const SUNDAY = new Date('2026-11-08T06:00:00Z');
const THURSDAY = new Date('2026-11-12T06:00:00Z');
const WEEK = '2026-11-08';

beforeEach(() => setNow(SUNDAY));

/**
 * The office of the factories: usr_001 is the Admin, usr_002 leads prj_001, usr_003 (Sara) is on its team, usr_004 is outside it and usr_005
 * is the agent of Sara. Sara leads tsk_001 and helps on tsk_002; Faisal leads tsk_003.
 */
function office(roles?: Record<string, { off: OfficeRight[] }>) {
  const t = testApi(calls);
  const state = t.store.state;
  state.tasks.tsk_001 = makeTask({ id: 'tsk_001', title: 'Ground floor plan', ownerId: 'usr_003', dueDate: '2026-11-10' });
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', title: 'Roof detail', ownerId: 'usr_002', helperIds: ['usr_003'], dueDate: '2026-11-11' });
  state.tasks.tsk_003 = makeTask({ id: 'tsk_003', title: 'Faisal only', ownerId: 'usr_002' });
  state.counters.tsk = 3;
  if (roles) {
    const custom = Object.entries(roles).map(([userId, spec], index) => {
      const id = `rol_${String(index + 1).padStart(3, '0')}`;
      state.users[userId].roleId = id;
      return { id, name: `Role ${index + 1}`, nameAr: `دور ${index + 1}`, rights: [], off: spec.off };
    });
    state.settings.roles = { custom };
    state.counters.rol = custom.length;
  }
  return t;
}

const events = (t: ReturnType<typeof office>) => Object.values(t.store.state.events).filter((event) => event.targetType === 'checkin');

describe('checkins.save (fbk_088)', () => {
  it('saves the plan of the week with the ids of the kept to-dos, answers with their lines, and writes one event', async () => {
    const t = office();
    t.as('usr_003');
    const answer = await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001', 'tsk_002'], text: '  Visit the site on Tuesday.  ' });
    expect(answer).toMatchObject({
      id: 'chk_001', userId: 'usr_003', week: WEEK, kind: 'plan', text: 'Visit the site on Tuesday.',
      items: [{ taskId: 'tsk_001', title: 'Ground floor plan' }, { taskId: 'tsk_002', title: 'Roof detail' }],
    });
    expect(events(t).map((event) => [event.verb, event.projectId, event.targetId, event.actingForId])).toEqual([['checkin.created', null, 'chk_001', 'usr_003']]);
  });

  it('takes the week from the day: Thursday saves into the same week, and a review is its own answer', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Plan.' });
    setNow(THURSDAY);
    const review = await t.api.call('checkins.save', { kind: 'review', items: ['tsk_001'], text: '' });
    expect(review).toMatchObject({ id: 'chk_002', week: WEEK, kind: 'review' });
    expect(Object.keys(checkinsOf(t.store.state))).toEqual(['chk_001', 'chk_002']);
  });

  it('changes the same answer on a second save, with an update event, and writes nothing when nothing changes', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001'], text: 'First.' });
    const again = await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001'], text: 'First.' });
    expect(again.id).toBe('chk_001');
    expect(events(t)).toHaveLength(1);
    const changed = await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Second.' });
    expect(changed).toMatchObject({ id: 'chk_001', items: [], text: 'Second.' });
    expect(Object.keys(checkinsOf(t.store.state))).toEqual(['chk_001']);
    expect(events(t).map((event) => event.verb)).toEqual(['checkin.created', 'checkin.updated']);
  });

  it('refuses an empty answer, and a to-do that is not the own to-do of the person', async () => {
    const t = office();
    t.as('usr_003');
    await expect(t.api.call('checkins.save', { kind: 'plan', items: [], text: '   ' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'empty_answer' } });
    await expect(t.api.call('checkins.save', { kind: 'plan', items: ['tsk_003'], text: 'x' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'not_your_task' } });
    await expect(t.api.call('checkins.save', { kind: 'plan', items: ['tsk_404'], text: 'x' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'not_your_task' } });
    expect(Object.keys(checkinsOf(t.store.state))).toEqual([]);
  });

  it('saves an office to-do and a to-do of a hidden project as ids: the author reads both lines, an answer of only such to-dos is not empty', async () => {
    const t = office();
    const state = t.store.state;
    state.tasks.tsk_010 = makeTask({ id: 'tsk_010', projectId: null, stageId: null, title: 'Private office to-do', ownerId: 'usr_003' });
    state.projects.prj_002 = { ...state.projects.prj_001, id: 'prj_002', code: 'KH-26-002', name: 'Secret Tower', access: { hidden: true, viewerIds: [] } };
    state.members[memberKey('prj_002', 'usr_003')] = { projectId: 'prj_002', userId: 'usr_003', discipline: 'Architect' };
    state.tasks.tsk_011 = makeTask({ id: 'tsk_011', projectId: 'prj_002', stageId: null, title: 'Secret to-do', ownerId: 'usr_003' });
    t.as('usr_003');
    const answer = await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_010', 'tsk_011', 'tsk_001'], text: '' });
    expect(answer.items.map((line) => line.taskId)).toEqual(['tsk_010', 'tsk_011', 'tsk_001']);
    expect(checkinsOf(state).chk_001.taskIds).toEqual(['tsk_010', 'tsk_011', 'tsk_001']);
    const review = await t.api.call('checkins.save', { kind: 'review', items: ['tsk_010'], text: '' });
    expect(review.items).toEqual([{ taskId: 'tsk_010', title: 'Private office to-do' }]);
  });

  it('saves for the person when the agent of the person asks, and refuses a person without the switch', async () => {
    const t = office({ usr_004: { off: ['checkin.answer'] } });
    t.as('usr_005');
    const answer = await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001'], text: '' });
    expect(answer.userId).toBe('usr_003');
    expect(events(t)[0]).toMatchObject({ actorId: 'usr_005', actingForId: 'usr_003' });
    t.as('usr_004');
    await expect(t.api.call('checkins.save', { kind: 'plan', items: [], text: 'x' })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'checkin.answer' } });
  });

  it('refuses the text over the limit and more lines than the limit', async () => {
    const t = office();
    t.as('usr_003');
    await expect(t.api.call('checkins.save', { kind: 'plan', items: [], text: 'x'.repeat(2001) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('checkins.save', { kind: 'plan', items: Array.from({ length: 31 }, () => 'tsk_001'), text: 'x' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('checkins.mine', () => {
  it('gives the own plan and review of the week, null for a kind with no answer, and never the answer of another person', async () => {
    const t = office();
    t.as('usr_002');
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Faisal plan.' });
    t.as('usr_003');
    expect(await t.api.call('checkins.mine', {})).toEqual({ week: WEEK, plan: null, review: null });
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Sara plan.' });
    const mine = await t.api.call('checkins.mine', { week: '2026-11-10' });
    expect(mine.week).toBe(WEEK);
    expect(mine.plan?.text).toBe('Sara plan.');
    expect(mine.review).toBeNull();
    expect(await t.api.call('checkins.mine', { week: '2026-11-01' })).toEqual({ week: '2026-11-01', plan: null, review: null });
  });

  it('refuses a week that has not begun', async () => {
    const t = office();
    t.as('usr_003');
    await expect(t.api.call('checkins.mine', { week: '2026-11-15' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'week_future' } });
  });
});

describe('checkins.week', () => {
  it('shows every answer of the week to every person, with the plan and the review side by side and the people who have not answered', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001'], text: 'Sara plan.' });
    t.as('usr_002');
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Faisal plan.' });
    t.as('usr_004');
    const view = await t.api.call('checkins.week', {});
    expect(view.week).toBe(WEEK);
    expect(view.previous).toBe('2026-11-01');
    expect(view.next).toBeNull();
    expect(view.rows.map((row) => [row.user.id, row.plan?.text, row.review])).toEqual([['usr_002', 'Faisal plan.', null], ['usr_003', 'Sara plan.', null]]);
    // The agent is no person who answers. The review is not due on Sunday, so nobody is missing a review yet.
    expect(view.missing.plan.map((user) => user.id)).toEqual(['usr_001', 'usr_004']);
    expect(view.missing.review).toEqual([]);
  });

  it('lists who has not reviewed from Thursday, and reads a past week with a link to the week after it', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Plan.' });
    setNow(THURSDAY);
    await t.api.call('checkins.save', { kind: 'review', items: [], text: 'Done.' });
    t.as('usr_001');
    const view = await t.api.call('checkins.week', {});
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({ user: { id: 'usr_003' }, plan: { text: 'Plan.' }, review: { text: 'Done.' } });
    expect(view.missing.review.map((user) => user.id)).toEqual(['usr_002', 'usr_001', 'usr_004']);
    setNow(new Date('2026-11-16T06:00:00Z'));
    const past = await t.api.call('checkins.week', { week: WEEK });
    expect(past.next).toBe('2026-11-15');
    expect(past.missing.review.map((user) => user.id)).toEqual(['usr_002', 'usr_001', 'usr_004']);
    const now = await t.api.call('checkins.week', {});
    expect(now.week).toBe('2026-11-15');
    expect(now.rows).toEqual([]);
  });

  it('keeps a person who left in the rows of the week where they answered, and out of the missing lists', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Plan.' });
    t.store.state.users.usr_003.active = false;
    t.as('usr_001');
    const view = await t.api.call('checkins.week', {});
    expect(view.rows.map((row) => row.user.id)).toEqual(['usr_003']);
    expect(view.missing.plan.map((user) => user.id)).not.toContain('usr_003');
  });

  it('does not name a person without the switch "Answer the weekly question" as missing, and still names a person with the switch and no answer', async () => {
    const t = office({ usr_004: { off: ['checkin.answer'] } });
    setNow(THURSDAY);
    t.as('usr_001');
    const view = await t.api.call('checkins.week', {});
    // usr_004 may not answer, so the lists leave that person out. The others have the switch and no answer, so they stay.
    expect(view.missing.plan.map((user) => user.id)).toEqual(['usr_002', 'usr_001', 'usr_003']);
    expect(view.missing.review.map((user) => user.id)).toEqual(['usr_002', 'usr_001', 'usr_003']);
  });

  it('needs the switch "Read the weekly answers", for the person and for the agent of the person', async () => {
    const t = office({ usr_004: { off: ['checkin.read'] } });
    t.as('usr_004');
    await expect(t.api.call('checkins.week', {})).rejects.toMatchObject({ code: 'forbidden', details: { action: 'checkin.read' } });
    // The own answers stay readable: the card reads them whatever the switch.
    expect((await t.api.call('checkins.mine', {})).week).toBe(WEEK);
    t.as('usr_003');
    expect((await t.api.call('checkins.week', {})).week).toBe(WEEK);
  });
});

describe('the Undo of a save', () => {
  it('takes back the first save (the answer goes) and the second save (the old lines come back), for the author only', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001'], text: 'First.' });
    const created = events(t)[0];
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Second.' });
    const updated = events(t)[1];
    t.as('usr_004');
    await expect(t.api.call('events.undo', { eventId: updated.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await expect(t.api.call('events.undo', { eventId: updated.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await t.api.call('events.undo', { eventId: updated.id });
    expect(checkinsOf(t.store.state).chk_001).toMatchObject({ text: 'First.', taskIds: ['tsk_001'] });
    await t.api.call('events.undo', { eventId: created.id });
    expect(checkinsOf(t.store.state)).toEqual({});
  });

  it('lets the agent of the author take back the save of the author', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'First.' });
    t.as('usr_005');
    await t.api.call('events.undo', { eventId: events(t)[0].id });
    expect(checkinsOf(t.store.state)).toEqual({});
  });
});

/**
 * Security review of fbk_088. An answer stores the ids of the to-dos and no title. Each line is built when the answer is read, from the live
 * to-do, and only when the reader may view that to-do. So a project that is hidden after the answer hides its titles at once.
 */
describe('the lines of an answer are built when it is read', () => {
  const linesOf = async (t: ReturnType<typeof office>, userId: string, kind: 'plan' | 'review' = 'plan') => {
    t.as(userId);
    const view = await t.api.call('checkins.week', {});
    return view.rows.flatMap((row) => (row[kind]?.items ?? []).map((line) => line.title));
  };

  it('stores the ids and no title, in the record and in the events', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001', 'tsk_002'], text: 'Words.' });
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001'], text: 'Words.' });
    expect(checkinsOf(t.store.state).chk_001).toMatchObject({ taskIds: ['tsk_001'] });
    expect(checkinsOf(t.store.state).chk_001).not.toHaveProperty('items');
    const stored = JSON.stringify([checkinsOf(t.store.state), Object.values(t.store.state.events)]);
    expect(stored).not.toContain('Ground floor plan');
    expect(stored).not.toContain('Roof detail');
  });

  it('reads the title the to-do has now, and gives no line for a to-do that was deleted', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001', 'tsk_002'], text: '' });
    t.store.state.tasks.tsk_001.title = 'Ground floor plan v2';
    delete t.store.state.tasks.tsk_002;
    expect(await linesOf(t, 'usr_004')).toEqual(['Ground floor plan v2']);
    expect((await t.api.call('checkins.mine', {})).plan).toBeNull();
    t.as('usr_003');
    expect((await t.api.call('checkins.mine', {})).plan?.items).toEqual([{ taskId: 'tsk_001', title: 'Ground floor plan v2' }]);
  });

  it('hides the titles of a project that is hidden after the answer from the people outside it, and keeps them for its people', async () => {
    const t = office();
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001', 'tsk_002'], text: 'Words stay.' });
    expect(await linesOf(t, 'usr_004')).toEqual(['Ground floor plan', 'Roof detail']);
    t.store.state.projects.prj_001.access = { hidden: true, viewerIds: [] };
    // The outsider keeps the row and the words of the answer, and gets no title of the project.
    t.as('usr_004');
    const outside = await t.api.call('checkins.week', {});
    expect(outside.rows[0]).toMatchObject({ user: { id: 'usr_003' }, plan: { text: 'Words stay.', items: [] } });
    // The author, the leader and the Admin view the project, so they keep the lines.
    expect(await linesOf(t, 'usr_003')).toEqual(['Ground floor plan', 'Roof detail']);
    expect(await linesOf(t, 'usr_002')).toEqual(['Ground floor plan', 'Roof detail']);
    expect(await linesOf(t, 'usr_001')).toEqual(['Ground floor plan', 'Roof detail']);
    // The author who leaves the project reads no title of it either, in the own answer too.
    delete t.store.state.members[memberKey('prj_001', 'usr_003')];
    t.as('usr_003');
    expect((await t.api.call('checkins.mine', {})).plan).toMatchObject({ text: 'Words stay.', items: [] });
  });

  it('shows an office to-do and a to-do of a hidden project to the people who view them, and to nobody else', async () => {
    const t = office();
    const state = t.store.state;
    state.tasks.tsk_010 = makeTask({ id: 'tsk_010', projectId: null, stageId: null, title: 'Private office to-do', ownerId: 'usr_003', helperIds: ['usr_002'], createdBy: 'usr_003' });
    state.projects.prj_002 = { ...state.projects.prj_001, id: 'prj_002', code: 'KH-26-002', name: 'Secret Tower', leaderId: 'usr_002', access: { hidden: true, viewerIds: [] } };
    state.members[memberKey('prj_002', 'usr_003')] = { projectId: 'prj_002', userId: 'usr_003', discipline: 'Architect' };
    state.tasks.tsk_011 = makeTask({ id: 'tsk_011', projectId: 'prj_002', stageId: null, title: 'Secret to-do', ownerId: 'usr_003' });
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_010', 'tsk_011', 'tsk_001'], text: '' });
    // usr_004 views no one of the three hidden things, usr_002 helps on the office to-do and leads the hidden project.
    expect(await linesOf(t, 'usr_004')).toEqual(['Ground floor plan']);
    expect(await linesOf(t, 'usr_002')).toEqual(['Private office to-do', 'Secret to-do', 'Ground floor plan']);
    expect(await linesOf(t, 'usr_003')).toEqual(['Private office to-do', 'Secret to-do', 'Ground floor plan']);
    // The outsider cannot tell how many lines the answer keeps: the answer holds no count of them.
    t.as('usr_004');
    const outside = (await t.api.call('checkins.week', {})).rows[0].plan!;
    expect(Object.keys(outside).sort()).toEqual(['createdAt', 'id', 'items', 'kind', 'text', 'updatedAt', 'userId', 'week']);
    expect(JSON.stringify(outside)).not.toMatch(/tsk_010|tsk_011|Secret|Private office/);
  });

  it('gives the agent of a person the lines that the person reads, and no line the person may not view', async () => {
    const t = office();
    const state = t.store.state;
    state.projects.prj_002 = { ...state.projects.prj_001, id: 'prj_002', code: 'KH-26-002', name: 'Secret Tower', leaderId: 'usr_002', access: { hidden: true, viewerIds: [] } };
    state.tasks.tsk_011 = makeTask({ id: 'tsk_011', projectId: 'prj_002', stageId: null, title: 'Secret to-do', ownerId: 'usr_002' });
    t.as('usr_002');
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_011', 'tsk_003'], text: '' });
    // usr_005 is the agent of usr_003, who is not on the hidden project: the agent reads what usr_003 reads.
    expect(await linesOf(t, 'usr_005')).toEqual(['Faisal only']);
    expect(await linesOf(t, 'usr_003')).toEqual(['Faisal only']);
    expect(await linesOf(t, 'usr_002')).toEqual(['Secret to-do', 'Faisal only']);
  });
});

/**
 * Security review of fbk_088. The save writes History events (checkin.created, checkin.updated). They show to the holders of "Read the weekly
 * answers" and to the author only, in events.list, events.undo and events.undoStory. A person without the switch gets a missing event.
 */
describe('the History of a weekly answer', () => {
  /** usr_004 holds no "Read the weekly answers"; Sara (usr_003) writes a plan, Omar (usr_004) writes his own. */
  async function answered() {
    const t = office({ usr_004: { off: ['checkin.read'] } });
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_001'], text: 'Sara plan.' });
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Sara plan v2.' });
    t.as('usr_004');
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Omar plan.' });
    return t;
  }
  const checkinLines = async (t: ReturnType<typeof office>, userId: string, input: Record<string, unknown> = {}) => {
    t.as(userId);
    return (await t.api.call('events.list', { limit: 100, ...input })).filter((line) => line.event.targetType === 'checkin').map((line) => [line.event.verb, line.event.targetId]);
  };

  it('lists no change of an answer for a person without the switch, but the own changes of that person', async () => {
    const t = await answered();
    expect(await checkinLines(t, 'usr_004')).toEqual([['checkin.created', 'chk_002']]);
    expect(await checkinLines(t, 'usr_004', { targetType: 'checkin' })).toEqual([['checkin.created', 'chk_002']]);
    expect(await checkinLines(t, 'usr_004', { targetId: 'chk_001' })).toEqual([]);
  });

  it('lists every change of an answer for the holders of the switch: the author, the leader, the Admin and the agent of the author', async () => {
    const t = await answered();
    const all = [['checkin.updated', 'chk_001'], ['checkin.created', 'chk_001'], ['checkin.created', 'chk_002']].sort();
    for (const userId of ['usr_001', 'usr_002', 'usr_003', 'usr_005']) {
      expect((await checkinLines(t, userId)).sort(), userId).toEqual([['checkin.created', 'chk_002'], ['checkin.created', 'chk_001'], ['checkin.updated', 'chk_001']].sort());
    }
    expect(all).toHaveLength(3);
  });

  it('keeps the ids of the kept to-dos out of the events that it shows, so the History names no to-do that a reader may not view', async () => {
    const t = await answered();
    const state = t.store.state;
    state.projects.prj_002 = { ...state.projects.prj_001, id: 'prj_002', code: 'KH-26-002', name: 'Secret Tower', access: { hidden: true, viewerIds: [] } };
    state.members[memberKey('prj_002', 'usr_003')] = { projectId: 'prj_002', userId: 'usr_003', discipline: 'Architect' };
    state.tasks.tsk_011 = makeTask({ id: 'tsk_011', projectId: 'prj_002', stageId: null, title: 'Secret to-do', ownerId: 'usr_003' });
    t.as('usr_003');
    await t.api.call('checkins.save', { kind: 'review', items: ['tsk_011', 'tsk_001'], text: 'Done.' });
    for (const userId of ['usr_002', 'usr_003']) {
      t.as(userId);
      const lines = (await t.api.call('events.list', { targetType: 'checkin', limit: 100 }));
      expect(lines.length).toBeGreaterThan(0);
      expect(JSON.stringify(lines), userId).not.toMatch(/tsk_011|tsk_001|Secret/);
    }
    // The Undo answer carries none either, and it still takes the answer back.
    const created = events(t).find((event) => event.targetType === 'checkin' && (event.after as { kind?: string }).kind === 'review')!;
    const undone = await t.api.call('events.undo', { eventId: created.id });
    expect(JSON.stringify(undone)).not.toMatch(/tsk_011|tsk_001/);
    expect(Object.values(checkinsOf(state)).some((one) => one.kind === 'review')).toBe(false);
  });

  it('counts the agent of the author without the switch as the author', async () => {
    const t = office({ usr_003: { off: ['checkin.read'] } });
    t.as('usr_005');
    await t.api.call('checkins.save', { kind: 'plan', items: [], text: 'Sara plan by the agent.' });
    expect(await checkinLines(t, 'usr_005')).toEqual([['checkin.created', 'chk_001']]);
    expect(await checkinLines(t, 'usr_003')).toEqual([['checkin.created', 'chk_001']]);
    expect(await checkinLines(t, 'usr_002')).toEqual([['checkin.created', 'chk_001']]);
    // Omar holds the switch and reads it too; a person without the switch who is not the author does not.
    expect(await checkinLines(t, 'usr_004')).toEqual([['checkin.created', 'chk_001']]);
    const quiet = office({ usr_003: { off: ['checkin.read'] }, usr_004: { off: ['checkin.read'] } });
    quiet.as('usr_003');
    await quiet.api.call('checkins.save', { kind: 'plan', items: [], text: 'Sara plan.' });
    expect(await checkinLines(quiet, 'usr_004')).toEqual([]);
  });

  it('gives a missing event for the Undo of an answer that the person may not read, with the code and the text of an unknown event', async () => {
    const t = await answered();
    const first = events(t).find((event) => event.verb === 'checkin.created' && event.targetId === 'chk_001')!;
    t.as('usr_004');
    const missing = await t.api.call('events.undo', { eventId: 'evt_9999' }).catch((error: Error) => error);
    const hidden = await t.api.call('events.undo', { eventId: first.id }).catch((error: Error) => error);
    expect(hidden).toMatchObject({ code: 'not_found' });
    expect(hidden).toMatchObject({ code: (missing as unknown as { code: string }).code });
    expect((hidden as Error).message.replace(first.id, '#')).toBe((missing as Error).message.replace('evt_9999', '#'));
    expect(checkinsOf(t.store.state).chk_001).toBeDefined();
  });

  it('gives a missing story for the story Undo of an answer that the person may not read', async () => {
    const t = await answered();
    const second = events(t).find((event) => event.verb === 'checkin.updated')!;
    t.as('usr_004');
    const missing = await t.api.call('events.undoStory', { correlationId: 'cor_unknown_story' }).catch((error: Error) => error);
    const hidden = await t.api.call('events.undoStory', { correlationId: second.correlationId }).catch((error: Error) => error);
    expect(hidden).toMatchObject({ code: 'not_found' });
    expect((hidden as Error).message.replace(second.correlationId, '#')).toBe((missing as Error).message.replace('cor_unknown_story', '#'));
    expect(checkinsOf(t.store.state).chk_001).toMatchObject({ text: 'Sara plan v2.' });
  });

  it('lets the author without the switch take back the own answer, and refuses the same Undo with the same words as before for the others', async () => {
    const t = await answered();
    const own = events(t).find((event) => event.targetId === 'chk_002')!;
    t.as('usr_004');
    await t.api.call('events.undo', { eventId: own.id });
    expect(checkinsOf(t.store.state).chk_002).toBeUndefined();
    // A holder of the switch who is not the author still sees the change and is refused (assertMayUndo), as in the first batch of tests.
    const second = events(t).find((event) => event.verb === 'checkin.updated')!;
    t.as('usr_002');
    await expect(t.api.call('events.undo', { eventId: second.id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
