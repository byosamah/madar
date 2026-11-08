import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from './calls';
import { COPY_TRIGGERS } from './adminCopies';
import { IN_APP_ONLY_TRIGGERS, TRIGGERS, defaultPreferences, isEmailTrigger, Notification } from './contract/entities';
import { ACTION_TRIGGERS } from './handlers/notifications';
import { emailOn, runScheduledTriggers } from './notify';
import { checkinsOf, type State } from './store';
import { setNow } from '../lib/dates';
import { makeUser, makeWorld, STAMP, testApi } from '../test/factories';

/**
 * The reminder of the weekly question (fbk_088, owner 2026-11-08). One notice on Sunday from 08:00 (the plan) and one on Thursday from 14:00
 * (the review), Riyadh time, only to an active person who holds "Answer the weekly question" and has not answered. In the app and in push, never
 * in email. The world: usr_001 the Admin, usr_002 and usr_003 on the project, usr_004 outside it, usr_005 the agent of usr_003, and usr_006 who left.
 */
const SUNDAY_8 = new Date('2026-11-08T05:00:00Z');
const SUNDAY_759 = new Date('2026-11-08T04:59:00Z');
const SUNDAY_17 = new Date('2026-11-08T14:00:00Z');
const MONDAY_9 = new Date('2026-11-09T06:00:00Z');
const THURSDAY_14 = new Date('2026-11-12T11:00:00Z');
const THURSDAY_1359 = new Date('2026-11-12T10:59:00Z');
const WEEK = '2026-11-08';

let state: State;
beforeEach(() => {
  setNow(SUNDAY_8);
  state = makeWorld();
  state.users.usr_006 = makeUser('usr_006', { name: 'Gone Person', active: false });
  state.counters.usr = 6;
});

const week = (s: State) => Object.values(s.notifications).filter((n) => n.trigger === 'week_question');
const people = (s: State) => week(s).map((n) => n.userId).sort();

describe('the trigger week_question', () => {
  it('is in the list, stays in the app with no email, does not count on the bell and makes no copy for the Admin', () => {
    expect(TRIGGERS).toContain('week_question');
    expect([...IN_APP_ONLY_TRIGGERS]).toContain('week_question');
    expect(isEmailTrigger('week_question')).toBe(false);
    expect(emailOn({ ...defaultPreferences(), email: { week_question: true } }, 'week_question')).toBe(false);
    expect(ACTION_TRIGGERS.has('week_question')).toBe(false);
    expect(COPY_TRIGGERS.has('week_question')).toBe(false);
  });
});

describe('the Sunday notice (the plan)', () => {
  it('goes at 08:00 to every active person, the Admin too, and to no agent and nobody who left', () => {
    expect(runScheduledTriggers(state, SUNDAY_8)).toBe(4);
    expect(people(state)).toEqual(['usr_001', 'usr_002', 'usr_003', 'usr_004']);
    const mine = week(state).find((n) => n.userId === 'usr_003')!;
    expect(mine).toMatchObject({
      trigger: 'week_question', actorId: null, targetType: 'week', targetId: `plan:${WEEK}`, read: false, dedupeKey: `week_question:plan:${WEEK}:usr_003`,
    });
    expect(Notification.safeParse(mine).success).toBe(true);
  });

  it('does not go before 08:00, on Monday, or after the work hours', () => {
    expect(runScheduledTriggers(state, SUNDAY_759)).toBe(0);
    expect(runScheduledTriggers(state, MONDAY_9)).toBe(0);
    expect(runScheduledTriggers(state, SUNDAY_17)).toBe(0);
    expect(week(state)).toEqual([]);
  });

  it('is sent once: a later run of the same day, and a run that holds the used keys, send none', () => {
    expect(runScheduledTriggers(state, SUNDAY_8)).toBe(4);
    expect(runScheduledTriggers(state, new Date('2026-11-08T08:00:00Z'))).toBe(0);
    expect(runScheduledTriggers(state, SUNDAY_8, { dedupeUsed: () => true })).toBe(0);
    expect(week(state)).toHaveLength(4);
  });

  it('leaves out a person who answered, a person without the switch and a person who turned the notice off', () => {
    state.checkins = checkinsOf(state);
    state.checkins.chk_001 = { id: 'chk_001', userId: 'usr_002', week: WEEK, kind: 'plan', taskIds: [], text: 'Plan.', createdAt: STAMP, updatedAt: STAMP };
    state.users.usr_004.roleId = 'rol_001';
    state.settings.roles = { custom: [{ id: 'rol_001', name: 'Quiet', nameAr: 'هادئ', rights: [], off: ['checkin.answer'] }] };
    state.users.usr_001.preferences.notifications.week_question = false;
    runScheduledTriggers(state, SUNDAY_8);
    expect(people(state)).toEqual(['usr_003']);
  });
});

describe('the Thursday notice (the review)', () => {
  it('goes at 14:00 to the people who have no review, even when they sent the plan', () => {
    setNow(THURSDAY_14);
    state.checkins = {
      chk_001: { id: 'chk_001', userId: 'usr_002', week: WEEK, kind: 'plan', taskIds: [], text: 'Plan.', createdAt: STAMP, updatedAt: STAMP },
      chk_002: { id: 'chk_002', userId: 'usr_003', week: WEEK, kind: 'review', taskIds: [], text: 'Done.', createdAt: STAMP, updatedAt: STAMP },
    };
    expect(runScheduledTriggers(state, THURSDAY_1359)).toBe(0);
    expect(runScheduledTriggers(state, THURSDAY_14)).toBe(3);
    expect(people(state)).toEqual(['usr_001', 'usr_002', 'usr_004']);
    expect(week(state)[0]).toMatchObject({ targetType: 'week', targetId: `review:${WEEK}`, dedupeKey: `week_question:review:${WEEK}:${week(state)[0].userId}` });
  });

  it('does not go on Friday or Saturday', () => {
    expect(runScheduledTriggers(state, new Date('2026-11-13T11:00:00Z'))).toBe(0);
    expect(runScheduledTriggers(state, new Date('2026-11-14T11:00:00Z'))).toBe(0);
  });
});

describe('the notice in the bell', () => {
  it('opens Home, is not gone, asks for no action and names no project', async () => {
    runScheduledTriggers(state, SUNDAY_8);
    const t = testApi(calls, state);
    t.as('usr_003');
    const [view] = await t.api.call('notifications.list', {});
    expect(view).toMatchObject({ link: '/', gone: false, needsAction: false, target: '', project: null, projectCode: null, actor: null });
    expect(view.notification).toMatchObject({ trigger: 'week_question', targetType: 'week', targetId: `plan:${WEEK}` });
    expect((await t.api.call('notifications.count', {})).badge).toBe(0);
  });
});
