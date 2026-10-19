import { beforeEach, describe, expect, it } from 'vitest';
import { activeAdmins, emailOn, feedbackNoticeHidden, inAppOn, notify, projectPeople, reviewersOf, runScheduledTriggers, visibleTriggers } from './notify';
import { TRIGGERS, defaultPreferences } from './contract/entities';
import type { State } from './store';
import { makeTask, makeUser, makeWorld, NOW, STAMP } from '../test/factories';

let state: State;
beforeEach(() => {
  state = makeWorld();
});

const byTrigger = (trigger: string) => Object.values(state.notifications).filter((n) => n.trigger === trigger);

describe('notify', () => {
  it('skips the actor, agents, inactive people and turned-off triggers', () => {
    state.users.usr_004.active = false;
    state.users.usr_003.preferences.notifications.mention = false;
    const made = notify(state, state.users.usr_002, STAMP, {
      userIds: ['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001',
    });
    expect(made.map((n) => n.userId)).toEqual(['usr_001']);
    expect(made[0].actorId).toBe('usr_002');
    expect(made[0].read).toBe(false);
  });

  it('creates one notification per dedupe key', () => {
    for (let i = 0; i < 3; i += 1) {
      notify(state, null, STAMP, { userIds: ['usr_003'], trigger: 'overdue', targetType: 'task', targetId: 'tsk_001', dedupeKey: 'overdue:tsk_001:2026-09-28' });
    }
    expect(Object.values(state.notifications)).toHaveLength(1);
  });

  it('sends reviews to the leader, or to every Admin with no leader', () => {
    expect(reviewersOf(state, 'prj_001')).toEqual(['usr_002']);
    state.projects.prj_001.leaderId = null;
    expect(reviewersOf(state, 'prj_001')).toEqual(['usr_001']);
  });

  it('lists the people on a project', () => {
    expect(projectPeople(state, 'prj_001').sort()).toEqual(['usr_002', 'usr_003']);
  });

  it('keeps the message and the reply mark on the notice', () => {
    const faisal = state.users.usr_002;
    const [n] = notify(state, faisal, STAMP, { userIds: ['usr_003'], trigger: 'mention', targetType: 'chat', targetId: 'cnv_001', messageId: 'msg_009', reply: true });
    expect(n).toMatchObject({ messageId: 'msg_009', reply: true });
    const [plain] = notify(state, faisal, STAMP, { userIds: ['usr_003'], trigger: 'mention', targetType: 'chat', targetId: 'cnv_001' });
    expect(plain).not.toHaveProperty('messageId');
    expect(plain).not.toHaveProperty('reply');
    // A message mark with no reply mark gives a notice with no reply key.
    const [named] = notify(state, faisal, STAMP, { userIds: ['usr_003'], trigger: 'mention', targetType: 'chat', targetId: 'cnv_001', messageId: 'msg_010' });
    expect(named).toMatchObject({ messageId: 'msg_010' });
    expect(named).not.toHaveProperty('reply');
  });

  it('does not tell a person about their own agent', () => {
    const made = notify(state, state.users.usr_005, STAMP, { userIds: ['usr_002', 'usr_003'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001' });
    expect(made.map((n) => n.userId)).toEqual(['usr_002']);
  });
});

describe('runScheduledTriggers', () => {
  beforeEach(() => {
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', dueDate: '2026-10-01' });
    state.tasks.tsk_002 = makeTask({ id: 'tsk_002', dueDate: '2026-09-28', status: 'in_progress' });
    state.tasks.tsk_003 = makeTask({ id: 'tsk_003', dueDate: '2026-09-28', status: 'in_review' });
  });

  it('creates the due-tomorrow and overdue notices once', () => {
    expect(runScheduledTriggers(state, NOW)).toBe(2);
    expect(runScheduledTriggers(state, NOW)).toBe(0);
    expect(byTrigger('due_tomorrow').map((n) => n.targetId)).toEqual(['tsk_001']);
    expect(byTrigger('overdue').map((n) => n.targetId)).toEqual(['tsk_002']);
  });

  it('uses the office day near midnight', () => {
    state.tasks = {};
    runScheduledTriggers(state, new Date('2026-09-30T23:30:00Z'));
    expect(Object.values(state.notifications)).toHaveLength(0);
  });

  it('ignores tasks in projects that are not active', () => {
    state.projects.prj_001.status = 'on_hold';
    expect(runScheduledTriggers(state, NOW)).toBe(0);
  });
});

describe('the dedupe lookup (plan 4.13, A3; AM 7.3)', () => {
  const remind = (s: State, options?: { dedupeUsed(key: string): boolean }) =>
    notify(s, null, STAMP, { userIds: ['usr_003'], trigger: 'overdue', targetType: 'task', targetId: 'tsk_001', dedupeKey: 'overdue:tsk_001:2026-09-28' }, options);

  it('asks the lookup for the key of each person, instead of the scan', () => {
    const asked: string[] = [];
    remind(state);
    // The lookup answers for the key. The notice already in the state does not count, so the server never needs every notice.
    const made = remind(state, { dedupeUsed: (key) => (asked.push(key), false) });
    expect(asked).toEqual(['overdue:tsk_001:2026-09-28:usr_003']);
    expect(made).toHaveLength(1);
    expect(remind(state, { dedupeUsed: () => true })).toEqual([]);
  });

  it('gives the same notices with and without the lookup', () => {
    state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', dueDate: '2026-10-01' });
    state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', dueDate: '2026-09-28' });
    state.tasks.tsk_003 = makeTask({ id: 'tsk_003', ownerId: 'usr_002', helperIds: ['usr_003'], dueDate: '2026-09-27' });
    state.projects.prj_002 = { ...state.projects.prj_001, id: 'prj_002', status: 'on_hold', pause: { reason: 'Client', resumeOn: '2026-09-29', by: 'usr_002', at: STAMP } };
    const other = structuredClone(state);
    const lookupOf = (s: State) => ({ dedupeUsed: (key: string) => Object.values(s.notifications).some((n) => n.dedupeKey === key) });
    const keysOf = (s: State) => Object.values(s.notifications).map((n) => [n.id, n.userId, n.trigger, n.targetId, n.dedupeKey]);

    expect(runScheduledTriggers(state, NOW)).toBe(runScheduledTriggers(other, NOW, lookupOf(other)));
    expect(keysOf(other)).toEqual(keysOf(state));
    expect(keysOf(state).length).toBeGreaterThan(3);
    expect(runScheduledTriggers(other, NOW, lookupOf(other))).toBe(0);
  });

});

// The in-app switches read a missing key as on, and the two notices of requests and bugs stay in the app (owner, 2026-10-07).
describe('the switches and the notices of requests and bugs', () => {
  it('sends a notice for a switch that the stored person does not have yet', () => {
    delete state.users.usr_003.preferences.notifications.mention;
    const made = notify(state, state.users.usr_002, STAMP, { userIds: ['usr_003'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001' });
    expect(made.map((n) => n.userId)).toEqual(['usr_003']);
  });

  it('reads an in-app switch as on when it is not there, and as off when it is false', () => {
    const prefs = defaultPreferences();
    delete prefs.notifications.feedback_done;
    expect(inAppOn(prefs, 'feedback_done')).toBe(true);
    prefs.notifications.feedback_done = false;
    expect(inAppOn(prefs, 'feedback_done')).toBe(false);
    expect(inAppOn(prefs, 'mention')).toBe(true);
  });

  it('never sends an email for the two in-app notices, even when a stored email switch says on', () => {
    const prefs = { ...defaultPreferences(), email: { feedback_done: true, feedback_sent: true, mention: true } };
    expect(emailOn(prefs, 'feedback_done')).toBe(false);
    expect(emailOn(prefs, 'feedback_sent')).toBe(false);
    expect(emailOn(prefs, 'mention')).toBe(true);
  });

  it('copies the kind and the excerpt of the report into the notice', () => {
    const [made] = notify(state, state.users.usr_003, STAMP, {
      userIds: ['usr_001'], trigger: 'feedback_sent', targetType: 'feedback', targetId: 'fbk_001', feedback: { kind: 'bug', excerpt: 'The board does not scroll.' },
    });
    expect(made).toMatchObject({ userId: 'usr_001', targetType: 'feedback', targetId: 'fbk_001', dedupeKey: null, feedback: { kind: 'bug', excerpt: 'The board does not scroll.' } });
    expect(state.notifications[made.id].feedback).toEqual({ kind: 'bug', excerpt: 'The board does not scroll.' });
    const [plain] = notify(state, state.users.usr_002, STAMP, { userIds: ['usr_003'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001' });
    expect('feedback' in plain).toBe(false);
  });

  it('shows the switch of a new report only to a person who manages the office', () => {
    expect(visibleTriggers(state.users.usr_003)).not.toContain('feedback_sent');
    expect(visibleTriggers(state.users.usr_003)).toContain('feedback_done');
    expect(visibleTriggers(state.users.usr_003)).toHaveLength(TRIGGERS.length - 1);
    expect(visibleTriggers(state.users.usr_001)).toEqual([...TRIGGERS]);
    expect(visibleTriggers(state.users.usr_001)).toHaveLength(13);
  });

  it('lists every active human Admin, never an agent or a person who left', () => {
    state.users.usr_002.systemRole = 'admin';
    state.users.usr_006 = makeUser('usr_006', { systemRole: 'admin', active: false });
    state.users.usr_007 = makeUser('usr_007', { systemRole: 'management' });
    state.users.usr_009 = makeUser('usr_009', { kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
    expect(activeAdmins(state).sort()).toEqual(['usr_001', 'usr_002']);
  });

  it('hides a new-report notice from a person who no longer manages the office, and never a done notice', () => {
    const sent = { ...notify(state, state.users.usr_003, STAMP, { userIds: ['usr_001'], trigger: 'feedback_sent', targetType: 'feedback', targetId: 'fbk_001', feedback: { kind: 'bug', excerpt: 'x' } })[0] };
    expect(feedbackNoticeHidden(sent, state.users.usr_001)).toBe(false);
    expect(feedbackNoticeHidden(sent, state.users.usr_003)).toBe(true);
    expect(feedbackNoticeHidden({ ...sent, trigger: 'feedback_done' }, state.users.usr_003)).toBe(false);
    expect(feedbackNoticeHidden({ ...sent, targetType: 'task', trigger: 'mention' }, state.users.usr_003)).toBe(false);
  });
});
