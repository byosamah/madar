import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { EMAIL_TRIGGERS, IN_APP_ONLY_TRIGGERS, TRIGGERS, isEmailTrigger, type Notification } from '../contract/entities';
import { emailOn, inAppOn, visibleTriggers } from '../notify';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The notices of a meeting (fbk_022, owner 2026-10-19): meeting_invited (a new, moved or cancelled meeting) and meeting_soon. Both stay
 * in the app: no email, and no email switch. The world of the factories: Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001,
 * Sara (usr_003) is on its team, Omar (usr_004) is on no team, usr_005 is the agent of Sara. Nour (usr_006) and Lina (usr_007) are
 * Members.
 */
function world() {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  t.store.state.users.usr_007 = makeUser('usr_007', { name: 'Lina Member' });
  t.store.state.counters.usr = 7;
  return t;
}

const START = '2026-10-01T10:00:00+03:00';
const project = (extra: Record<string, unknown> = {}) => ({ kind: 'client' as const, title: 'Review the facade', projectId: 'prj_001', startsAt: START, ...extra });
const office = (extra: Record<string, unknown> = {}) => ({ kind: 'meeting' as const, title: 'Meet a new client', startsAt: START, ...extra });

type T = ReturnType<typeof world>;
/** The meeting notices, as [person, trigger, change], in the order they were made. */
const notices = (t: T): Notification[] => Object.values(t.store.state.notifications).filter((n) => n.targetType === 'meeting');
const summary = (t: T) => notices(t).map((n) => [n.userId, n.trigger, n.meeting?.change]);

describe('the two triggers', () => {
  it('are in the list of triggers, stay in the app, and send no email', () => {
    expect(TRIGGERS).toContain('meeting_invited');
    expect(TRIGGERS).toContain('meeting_soon');
    expect([...IN_APP_ONLY_TRIGGERS]).toEqual(expect.arrayContaining(['meeting_invited', 'meeting_soon']));
    expect(EMAIL_TRIGGERS).not.toContain('meeting_invited');
    expect(EMAIL_TRIGGERS).not.toContain('meeting_soon');
    const person = makeUser('usr_010', { preferences: { ...makeUser('usr_010').preferences, email: { meeting_invited: true, meeting_soon: true } } });
    for (const trigger of ['meeting_invited', 'meeting_soon'] as const) {
      expect(isEmailTrigger(trigger)).toBe(false);
      expect(emailOn(person.preferences, trigger)).toBe(false);
      expect(inAppOn(person.preferences, trigger)).toBe(true);
    }
  });

  it('show as switches in Settings by themselves, for every person, and refuse an email switch', async () => {
    const t = world();
    for (const person of ['usr_001', 'usr_003']) {
      t.as(person);
      const user = await t.api.call('session.get', {});
      expect(visibleTriggers(user.authority)).toEqual(expect.arrayContaining(['meeting_invited', 'meeting_soon']));
    }
    t.as('usr_003');
    await t.api.call('notifications.updateSettings', { trigger: 'meeting_soon', on: false });
    expect(t.store.state.users.usr_003.preferences.notifications.meeting_soon).toBe(false);
    await expect(t.api.call('notifications.updateSettings', { channel: 'email', trigger: 'meeting_invited', on: true })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'in_app_only' } });
  });

  it('count on the bell, because they ask for a look soon', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_004'] }));
    t.as('usr_004');
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 1, badge: 1 });
  });
});

describe('a new meeting', () => {
  it('tells each attendee "new" and nobody else, not the actor', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_004', 'usr_002'] }));
    expect(summary(t)).toEqual([['usr_004', 'meeting_invited', 'new'], ['usr_002', 'meeting_invited', 'new']]);
    for (const n of notices(t)) expect(n).toMatchObject({ targetType: 'meeting', targetId: made.id, actorId: 'usr_003', read: false, dedupeKey: null });
    expect(notices(t)[0].correlationId).toBeTruthy();
  });

  it('tells nobody for a meeting with no attendees, and nobody for a meeting where the only attendee is the actor', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project());
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_003'] }));
    expect(notices(t)).toEqual([]);
  });

  it('sends no notice to the person of an agent actor, who is the organizer, and names the agent as the actor', async () => {
    const t = world();
    t.as('usr_005');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_004', 'usr_003'] }));
    expect(summary(t)).toEqual([['usr_004', 'meeting_invited', 'new']]);
    expect(notices(t)[0].actorId).toBe('usr_005');
  });

  it('sends nothing to a person who turned the switch off', async () => {
    const t = world();
    t.store.state.users.usr_004.preferences.notifications.meeting_invited = false;
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_004', 'usr_002'] }));
    expect(summary(t)).toEqual([['usr_002', 'meeting_invited', 'new']]);
  });

  it('is taken back with its notices when the story is undone', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_004'] }));
    const created = Object.values(t.store.state.events).find((e) => e.verb === 'meeting.created' && e.targetId === made.id)!;
    await t.api.call('events.undoStory', { correlationId: created.correlationId });
    expect(notices(t)).toEqual([]);
  });
});

describe('a changed meeting', () => {
  const planned = async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_004', 'usr_002'] }));
    for (const id of Object.keys(t.store.state.notifications)) delete t.store.state.notifications[id];
    return { t, id: made.id };
  };

  it('tells every attendee "moved" for a new day, a new time or a new place, and for a new length', async () => {
    const { t, id } = await planned();
    for (const change of [{ startsAt: '2026-10-02T10:00:00+03:00' }, { startsAt: '2026-10-02T11:00:00+03:00' }, { where: 'Room 3' }, { durationMin: 30 }]) {
      await t.api.call('meetings.update', { id, ...change });
      expect(summary(t), JSON.stringify(change)).toEqual([['usr_004', 'meeting_invited', 'moved'], ['usr_002', 'meeting_invited', 'moved']]);
      for (const key of Object.keys(t.store.state.notifications)) delete t.store.state.notifications[key];
    }
  });

  it('tells nobody for a change of the title, the notes, the guests, the kind or the person for the minutes', async () => {
    const { t, id } = await planned();
    await t.api.call('meetings.update', { id, title: 'Other title', notes: 'Note', guests: 'A guest', kind: 'meeting' });
    await t.api.call('meetings.update', { id, minutesById: 'usr_004' });
    expect(notices(t)).toEqual([]);
  });

  it('tells an added attendee "new", and the others "moved" when the time moves in the same change', async () => {
    const { t, id } = await planned();
    await t.api.call('meetings.update', { id, attendeeIds: ['usr_004', 'usr_002', 'usr_006'], startsAt: '2026-10-02T10:00:00+03:00' });
    expect(summary(t).sort()).toEqual([['usr_002', 'meeting_invited', 'moved'], ['usr_004', 'meeting_invited', 'moved'], ['usr_006', 'meeting_invited', 'new']]);
  });

  it('tells only an added attendee when only the list of people changes, and a removed attendee nothing', async () => {
    const { t, id } = await planned();
    await t.api.call('meetings.update', { id, attendeeIds: ['usr_004', 'usr_006'] });
    expect(summary(t)).toEqual([['usr_006', 'meeting_invited', 'new']]);
  });

  it('tells the organizer "moved" when the leader moves a project meeting, and the organizer never when the organizer moves it', async () => {
    const { t, id } = await planned();
    t.as('usr_002');
    await t.api.call('meetings.update', { id, where: 'Room 8' });
    // Faisal (the leader) is also an attendee, but he is the actor. Sara, the organizer, and Omar hear it.
    expect(summary(t).sort()).toEqual([['usr_003', 'meeting_invited', 'moved'], ['usr_004', 'meeting_invited', 'moved']]);
  });

  it('tells every attendee "cancelled" on a cancel, once, and not again for a second cancel', async () => {
    const { t, id } = await planned();
    await t.api.call('meetings.cancel', { id });
    expect(summary(t)).toEqual([['usr_004', 'meeting_invited', 'cancelled'], ['usr_002', 'meeting_invited', 'cancelled']]);
    await t.api.call('meetings.cancel', { id });
    expect(notices(t)).toHaveLength(2);
  });

  it('tells the organizer "cancelled" when the Admin cancels a project meeting', async () => {
    const { t, id } = await planned();
    t.as('usr_001');
    await t.api.call('meetings.cancel', { id });
    expect(summary(t).sort()).toEqual([['usr_002', 'meeting_invited', 'cancelled'], ['usr_003', 'meeting_invited', 'cancelled'], ['usr_004', 'meeting_invited', 'cancelled']]);
  });

  it('tells a changed meeting of an Undo nothing new, and takes the notices of the story back', async () => {
    const { t, id } = await planned();
    await t.api.call('meetings.update', { id, where: 'Room 8' });
    const changed = Object.values(t.store.state.events).find((e) => e.verb === 'meeting.updated')!;
    expect(notices(t)).toHaveLength(2);
    await t.api.call('events.undoStory', { correlationId: changed.correlationId });
    expect(notices(t)).toEqual([]);
  });
});

describe('the notice as the screen reads it', () => {
  it('names the title, the start and the link of a project meeting, with the project tile', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', project({ attendeeIds: ['usr_004'] }));
    t.as('usr_004');
    const [view] = await t.api.call('notifications.list', {});
    expect(view).toMatchObject({
      target: 'Review the facade', gone: false, link: `/meetings?meeting=${made.id}`, needsAction: true, startsAt: '2026-10-01T10:00:00.000+03:00',
      project: { id: 'prj_001' }, actor: { id: 'usr_003' }, notification: { trigger: 'meeting_invited', meeting: { change: 'new' } },
    });
  });

  it('shows the new time of a moved meeting, and the old words of a cancelled one', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('meetings.create', office({ attendeeIds: ['usr_004'] }));
    await t.api.call('meetings.update', { id: made.id, startsAt: '2026-10-02T09:00:00+03:00' });
    await t.api.call('meetings.cancel', { id: made.id });
    t.as('usr_004');
    const views = await t.api.call('notifications.list', {});
    expect(views.map((view) => [view.notification.meeting?.change, view.startsAt])).toEqual([
      ['cancelled', '2026-10-02T09:00:00.000+03:00'], ['moved', '2026-10-02T09:00:00.000+03:00'], ['new', '2026-10-02T09:00:00.000+03:00'],
    ]);
    expect(views.every((view) => view.project === null && view.target === 'Meet a new client')).toBe(true);
  });

  it('reads a notice of a project that was deleted as gone', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('meetings.create', project({ attendeeIds: ['usr_004'] }));
    t.as('usr_001');
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    t.as('usr_004');
    expect(await t.api.call('notifications.list', {})).toEqual([]);
  });
});

describe('the notices of a meeting with no project (owner, 2026-10-19)', () => {
  const ORGANIZER = 'usr_004';
  const ATTENDEE = 'usr_003';
  const REMOVED = 'usr_006';
  const TITLE = 'Salary talk';

  async function secret() {
    const t = world();
    t.as(ORGANIZER);
    const made = await t.api.call('meetings.create', { kind: 'meeting', title: TITLE, startsAt: START, attendeeIds: [ATTENDEE, REMOVED] });
    return { t, id: made.id };
  }
  const noticesOf = async (t: T, person: string) => {
    t.as(person);
    return (await t.api.call('notifications.list', {})).filter((view) => view.notification.targetType === 'meeting');
  };
  const removeNour = (w: Awaited<ReturnType<typeof secret>>) => {
    w.t.as(ORGANIZER);
    return w.t.api.call('meetings.update', { id: w.id, attendeeIds: [ATTENDEE], minutesById: null });
  };

  it('go to the attendees only, and name the title and the time to them', async () => {
    const { t } = await secret();
    for (const person of ['usr_001', 'usr_002', ORGANIZER]) expect(await noticesOf(t, person), person).toEqual([]);
    const [view] = await noticesOf(t, ATTENDEE);
    expect(view).toMatchObject({ target: TITLE, gone: false, notification: { trigger: 'meeting_invited', meeting: { change: 'new' } } });
  });

  it('read as gone for an attendee who was taken off: no title, no time, no link, and no count on the badge', async () => {
    const w = await secret();
    w.t.as(REMOVED);
    expect((await w.t.api.call('notifications.count', {})).badge).toBe(1);
    await removeNour(w);
    const [view] = await noticesOf(w.t, REMOVED);
    expect(view).toMatchObject({ gone: true, target: '', projectCode: null, project: null, link: '/notifications', startsAt: null });
    expect(JSON.stringify(view)).not.toContain(TITLE);
    w.t.as(REMOVED);
    expect((await w.t.api.call('notifications.count', {})).badge).toBe(0);
    // A change after the removal tells Nour nothing.
    w.t.as(ORGANIZER);
    await w.t.api.call('meetings.cancel', { id: w.id });
    expect(await noticesOf(w.t, REMOVED)).toHaveLength(1);
    expect((await noticesOf(w.t, REMOVED))[0].gone).toBe(true);
  });

  it('keep the hidden notice hidden when the Undo of the story of the removal runs', async () => {
    const w = await secret();
    await removeNour(w);
    const removal = Object.values(w.t.store.state.events).filter((e) => e.verb === 'meeting.updated').at(-1)!;
    w.t.as(ORGANIZER);
    await w.t.api.call('events.undoStory', { correlationId: removal.correlationId });
    // Nour is on the list again, so the old notice reads as before. The notice of the attendee is whole all the time.
    expect((await noticesOf(w.t, ATTENDEE))[0].gone).toBe(false);
    expect(await noticesOf(w.t, REMOVED)).toHaveLength(1);
  });

  it('tell an Admin who is invited, as any attendee, and nobody else of the office', async () => {
    const t = world();
    t.as(ORGANIZER);
    await t.api.call('meetings.create', { kind: 'meeting', title: TITLE, startsAt: START, attendeeIds: ['usr_001'] });
    expect(summary(t)).toEqual([['usr_001', 'meeting_invited', 'new']]);
  });
});
