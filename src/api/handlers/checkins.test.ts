import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { OfficeRight } from '../contract/entities';
import { checkinsOf } from '../store';
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
  it('saves the plan of the week with the titles of the kept to-dos as the server has them, and one event', async () => {
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

  it('keeps the title of a private to-do out of an answer that everyone reads: an office to-do and a to-do of a hidden project', async () => {
    const t = office();
    const state = t.store.state;
    state.tasks.tsk_010 = makeTask({ id: 'tsk_010', projectId: null, stageId: null, title: 'Private office to-do', ownerId: 'usr_003' });
    state.projects.prj_002 = { ...state.projects.prj_001, id: 'prj_002', code: 'KH-26-002', name: 'Secret Tower', access: { hidden: true, viewerIds: [] } };
    state.tasks.tsk_011 = makeTask({ id: 'tsk_011', projectId: 'prj_002', stageId: null, title: 'Secret to-do', ownerId: 'usr_003' });
    t.as('usr_003');
    const answer = await t.api.call('checkins.save', { kind: 'plan', items: ['tsk_010', 'tsk_011', 'tsk_001'], text: '' });
    expect(answer.items).toEqual([{ taskId: 'tsk_001', title: 'Ground floor plan' }]);
    expect(JSON.stringify(Object.values(state.events))).not.toContain('Secret');
    expect(JSON.stringify(Object.values(state.events))).not.toContain('Private office');
    // An answer with only private to-dos and no text is empty.
    await expect(t.api.call('checkins.save', { kind: 'review', items: ['tsk_010'], text: '' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'empty_answer' } });
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
    expect(checkinsOf(t.store.state).chk_001).toMatchObject({ text: 'First.', items: [{ taskId: 'tsk_001', title: 'Ground floor plan' }] });
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
