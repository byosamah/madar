import { describe, expect, it } from 'vitest';
import type { Event, User } from '../../src/api/contract/entities';
import { defaultPreferences } from '../../src/api/contract/entities';
import { EFFECTS_OF } from '../core/effects';
import { fakeDeps } from '../test/fakes/deps';
import { AUTH_CALLS, AUTH_KINDS, authRowsOf, runAuthEffect } from './effects';
import { fakeAuth } from './fakeAuth';
import type { InviteStore, Person } from './invite';

function person(over: Partial<User> = {}): User {
  return {
    id: 'usr_012', name: 'Sara', email: 'sara@madar.test', avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect',
    active: true, ownerId: null, preferences: defaultPreferences(), ...over,
  };
}

function event(over: Partial<Event>): { event: Event } {
  return {
    event: {
      id: 'evt_100', seq: 100, createdAt: '2026-10-04T09:00:00.000+03:00', actorId: 'usr_001', actorKind: 'human', actingForId: 'usr_001',
      projectId: null, verb: 'undo', targetType: 'user', targetId: 'usr_012', before: null, after: null, correlationId: 'sty_x', ...over,
    } as Event,
  };
}

const kindsOf = (rows: { kind: string; payload: Record<string, unknown> }[]) => rows.map((r) => [r.kind, r.payload.userId]);

describe('authRowsOf: the outbox rows of the people calls (plan 4.12)', () => {
  it('users.create of an active person gives one auth.invite with an invite id; an agent gets none', () => {
    const rows = authRowsOf('users.create', person());
    expect(kindsOf(rows)).toEqual([[AUTH_KINDS.invite, 'usr_012']]);
    expect(rows[0].payload.inviteId).toMatch(/^inv_[a-z2-7]{22}$/);
    expect(authRowsOf('users.create', person({ kind: 'agent', ownerId: 'usr_001' }))).toEqual([]);
  });

  it('users.deactivate gives auth.ban, users.reactivate gives auth.unban, users.update gives auth.email with an invite id', () => {
    expect(kindsOf(authRowsOf('users.deactivate', person({ active: false })))).toEqual([[AUTH_KINDS.ban, 'usr_012']]);
    expect(kindsOf(authRowsOf('users.reactivate', person()))).toEqual([[AUTH_KINDS.unban, 'usr_012']]);
    const update = authRowsOf('users.update', person());
    expect(kindsOf(update)).toEqual([[AUTH_KINDS.email, 'usr_012']]);
    expect(update[0].payload.inviteId).toEqual(expect.any(String));
    // An agent has no Auth user of its own.
    expect(authRowsOf('users.deactivate', person({ kind: 'agent', ownerId: 'usr_001', active: false }))).toEqual([]);
  });

  it('an Undo of a person change gives the effect of what it brings back', () => {
    expect(kindsOf(authRowsOf('events.undo', event({ before: { active: true }, after: { active: false } })))).toEqual([[AUTH_KINDS.ban, 'usr_012']]);
    expect(kindsOf(authRowsOf('events.undo', event({ before: { active: false }, after: { active: true } })))).toEqual([[AUTH_KINDS.unban, 'usr_012']]);
    expect(kindsOf(authRowsOf('events.undo', event({ before: { email: 'b@madar.test' }, after: { email: 'a@madar.test' } })))).toEqual([[AUTH_KINDS.email, 'usr_012']]);
    expect(authRowsOf('events.undo', event({ before: { name: 'B' }, after: { name: 'A' } }))).toEqual([]);
    expect(authRowsOf('events.undo', event({ targetType: 'task', targetId: 'tsk_001', before: { active: true }, after: { active: false } }))).toEqual([]);
    // An Undo of users.create removes the person: no effect (the row and its sign-in link are gone).
    expect(authRowsOf('events.undo', event({ before: person() as never, after: null }))).toEqual([]);
    const story = { undone: [event({ id: 'evt_1', before: { active: false }, after: { active: true } }).event, event({ id: 'evt_2', before: { email: 'b@madar.test' }, after: { email: 'a@madar.test' } }).event].map((e) => ({ event: e })) };
    expect(kindsOf(authRowsOf('events.undoStory', story))).toEqual([[AUTH_KINDS.unban, 'usr_012'], [AUTH_KINDS.email, 'usr_012']]);
  });

  it('is registered for each of these calls, and for no other', () => {
    expect([...AUTH_CALLS].sort()).toEqual(['events.undo', 'events.undoStory', 'users.create', 'users.deactivate', 'users.reactivate', 'users.update']);
    for (const name of AUTH_CALLS) expect(EFFECTS_OF[name]?.length, name).toBe(1);
  });
});

/** One person row in memory, as the users table holds it. */
function memoryPeople(people: Person[]): InviteStore & { byId: Map<string, Person> } {
  const byId = new Map(people.map((p) => [p.user.id, p]));
  return {
    byId,
    async person(userId) {
      return byId.get(userId);
    },
    async keepLink(_inviteId, userId, link, relink) {
      if (relink) byId.get(userId)!.authUserId = link.authUserId;
    },
    async markSent() {},
  };
}

function setup(user: User, linked: boolean) {
  const deps = fakeDeps({ config: { appUrl: 'https://madar.test' } });
  const auth = fakeAuth(deps.authAdmin);
  deps.authAdmin = auth;
  return { deps, auth, user, linked };
}

async function linkedPerson(auth: ReturnType<typeof fakeAuth>, user: User, accepted: boolean): Promise<Person> {
  const { authUserId } = await auth.generateLink('invite', user.email);
  if (accepted) auth.accept(authUserId);
  return { user, authUserId };
}

describe('the auth effects (plan 5.1): each reads the person now, so a late retry never undoes a newer change', () => {
  it('auth.ban bans a turned-off person, and does nothing when the person is on again', async () => {
    const { deps, auth } = setup(person(), true);
    const off = await linkedPerson(auth, person({ active: false }), true);
    const store = memoryPeople([off]);
    await runAuthEffect(AUTH_KINDS.ban, { userId: 'usr_012' }, deps, store);
    expect(auth.users.get(off.authUserId!)!.banned).toBe(true);
    store.byId.get('usr_012')!.user = person({ active: true });
    auth.users.get(off.authUserId!)!.banned = false;
    await runAuthEffect(AUTH_KINDS.ban, { userId: 'usr_012' }, deps, store);
    expect(auth.users.get(off.authUserId!)!.banned).toBe(false);
  });

  it('auth.unban lifts the ban of an active person, and does nothing while the person is off', async () => {
    const { deps, auth } = setup(person(), true);
    const on = await linkedPerson(auth, person(), true);
    auth.users.get(on.authUserId!)!.banned = true;
    const store = memoryPeople([on]);
    store.byId.get('usr_012')!.user = person({ active: false });
    await runAuthEffect(AUTH_KINDS.unban, { userId: 'usr_012' }, deps, store);
    expect(auth.users.get(on.authUserId!)!.banned).toBe(true);
    store.byId.get('usr_012')!.user = person();
    await runAuthEffect(AUTH_KINDS.unban, { userId: 'usr_012' }, deps, store);
    expect(auth.users.get(on.authUserId!)!.banned).toBe(false);
  });

  it('auth.email gives Auth the new email; a person who accepted gets no mail', async () => {
    const { deps, auth } = setup(person(), true);
    const accepted = await linkedPerson(auth, person(), true);
    const store = memoryPeople([{ ...accepted, user: person({ email: 'sara.new@madar.test' }) }]);
    await runAuthEffect(AUTH_KINDS.email, { userId: 'usr_012', inviteId: 'inv_a' }, deps, store);
    expect(auth.users.get(accepted.authUserId!)!.email).toBe('sara.new@madar.test');
    expect(deps.mail.sent).toEqual([]);
  });

  it('auth.email for a person who did not accept yet sends a new invitation to the new email, so the link at the old email fails', async () => {
    const { deps, auth } = setup(person(), true);
    const pending = await linkedPerson(auth, person(), false);
    const store = memoryPeople([{ ...pending, user: person({ email: 'sara.new@madar.test' }) }]);
    await runAuthEffect(AUTH_KINDS.email, { userId: 'usr_012', inviteId: 'inv_b' }, deps, store);
    expect(auth.users.get(pending.authUserId!)!.email).toBe('sara.new@madar.test');
    expect(auth.links.map((l) => [l.type, l.email])).toEqual([['invite', 'sara@madar.test'], ['invite', 'sara.new@madar.test']]);
    expect(deps.mail.sent.map((m) => [m.to, m.idempotencyKey])).toEqual([['sara.new@madar.test', 'invite:inv_b']]);
  });

  it('auth.email does nothing when the email did not change (a name change), and the effects skip a person with no sign-in link', async () => {
    const { deps, auth } = setup(person(), true);
    const pending = await linkedPerson(auth, person(), false);
    const store = memoryPeople([pending, { user: person({ id: 'usr_013', email: 'x@madar.test', active: false }), authUserId: null }]);
    await runAuthEffect(AUTH_KINDS.email, { userId: 'usr_012', inviteId: 'inv_c' }, deps, store);
    for (const kind of [AUTH_KINDS.ban, AUTH_KINDS.unban, AUTH_KINDS.email]) await runAuthEffect(kind, { userId: 'usr_013', inviteId: 'inv_d' }, deps, store);
    expect([auth.links.length, deps.mail.sent.length]).toEqual([1, 0]);
  });
});
