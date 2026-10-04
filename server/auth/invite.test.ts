import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { defaultPreferences } from '../../src/api/contract/entities';
import { fakeDeps } from '../test/fakes/deps';
import { fakeAuth } from './fakeAuth';
import { INVITE_KIND, inviteRow, sendInvitation, type InviteStore, type Person, type SigninLink } from './invite';

function person(over: Partial<User> = {}): User {
  return {
    id: 'usr_012', name: 'Sara', email: 'sara@madar.test', avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect',
    active: true, ownerId: null, preferences: defaultPreferences(), ...over,
  };
}

/** The users rows and the outbox payloads in memory, as sqlInviteStore keeps them in the database. */
function memoryStore(people: Person[]) {
  const byId = new Map(people.map((p) => [p.user.id, p]));
  const payloads = new Map<string, Record<string, unknown>>();
  const relinks: { userId: string; authUserId: string }[] = [];
  /** The invite ids of the rows that a later row of the same person replaced with a newer link. */
  const replaced = new Set<string>();
  /** Runs at each read of the person: a test changes the person between two reads. */
  const reads: ((p: Person | undefined) => void)[] = [];
  const store: InviteStore = {
    async person(userId) {
      reads.shift()?.(byId.get(userId));
      return byId.get(userId);
    },
    async note(inviteId, fields) {
      payloads.set(inviteId, { ...payloads.get(inviteId), ...fields });
    },
    async newerLink(_userId, inviteId) {
      return replaced.has(inviteId);
    },
    async keepLink(inviteId, userId, link: SigninLink, relink) {
      payloads.set(inviteId, { ...payloads.get(inviteId), tokenHash: link.tokenHash, authUserId: link.authUserId, linkType: link.type });
      if (relink) {
        relinks.push({ userId, authUserId: link.authUserId });
        byId.get(userId)!.authUserId = link.authUserId;
      }
    },
    async markSent(inviteId, at, mailId) {
      const { tokenHash: _gone, ...rest } = payloads.get(inviteId) ?? {};
      payloads.set(inviteId, { ...rest, sentAt: at.toISOString(), mailId });
    },
  };
  return { store, payloads, relinks, byId, replaced, reads };
}

function setup(people: Person[]) {
  const deps = fakeDeps({ config: { appUrl: 'https://madar.test' } });
  const auth = fakeAuth(deps.authAdmin);
  deps.authAdmin = auth;
  const mem = memoryStore(people);
  /** The payload as the outbox row holds it after the earlier attempts. */
  const payloadOf = (row: { payload: Record<string, unknown> }) => ({ ...row.payload, ...mem.payloads.get(String(row.payload.inviteId)) });
  return { deps, auth, mem, payloadOf };
}

const linkIn = (text: string) => /https:\/\/madar\.test\/\S+/.exec(text)?.[0];

describe('sendInvitation: the auth.invite effect (plan 5.1 and 4.12)', () => {
  it('makes an invite link, links the Auth user with setAuthUserId, and sends the mail in English with a Welcome link', async () => {
    const { deps, auth, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    const row = inviteRow('usr_012');
    expect(row.kind).toBe(INVITE_KIND);
    expect(await sendInvitation(payloadOf(row), deps, { store: mem.store })).toBe('sent');
    expect(auth.links).toHaveLength(1);
    const { authUserId, tokenHash } = auth.links[0];
    expect(mem.relinks).toEqual([{ userId: 'usr_012', authUserId }]);
    const [mail] = deps.mail.sent;
    expect(mail).toMatchObject({ to: 'sara@madar.test', subject: 'Your invitation to Madar', tag: 'invite', idempotencyKey: `invite:${row.payload.inviteId}` });
    expect(linkIn(mail.text)).toBe(`https://madar.test/welcome?token_hash=${tokenHash}&type=invite`);
    expect(mem.payloads.get(String(row.payload.inviteId))).toMatchObject({ linkType: 'invite', sentAt: deps.clock.now().toISOString(), mailId: 'mail_1' });
  });

  it('writes the mail in Arabic, with the feminine forms, for an Arabic woman', async () => {
    const { deps, mem, payloadOf } = setup([{ user: person({ name: 'سارة', gender: 'female', preferences: { ...defaultPreferences(), language: 'ar' } }), authUserId: null }]);
    await sendInvitation(payloadOf(inviteRow('usr_012')), deps, { store: mem.store });
    expect(deps.mail.sent[0].subject).toBe('دعوتك إلى مدار');
    expect(deps.mail.sent[0].text).toContain('افتحي الرابط');
    expect(deps.mail.sent[0].html).toContain('dir="rtl"');
  });

  it('a retry after a failed send uses the token hash of the first link, so the first mail never carries a dead link', async () => {
    const { deps, auth, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    const row = inviteRow('usr_012');
    deps.mail.failNext(new Error('Resend is down'));
    await expect(sendInvitation(payloadOf(row), deps, { store: mem.store })).rejects.toThrow('Resend is down');
    expect(await sendInvitation(payloadOf(row), deps, { store: mem.store })).toBe('sent');
    expect(auth.links).toHaveLength(1);
    expect(linkIn(deps.mail.sent[0].text)).toContain(`token_hash=${auth.links[0].tokenHash}`);
    expect(mem.relinks).toHaveLength(1);
  });

  it('a retry does not send its stored link when a later invitation of the person made a newer link (the stored one is dead)', async () => {
    const { deps, auth, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    const row = inviteRow('usr_012');
    deps.mail.failNext(new Error('Resend is down'));
    await expect(sendInvitation(payloadOf(row), deps, { store: mem.store })).rejects.toThrow('Resend is down');
    // The Admin sends the invitation again: that row makes a newer link, so the link of the first row fails in Auth.
    mem.replaced.add(String(row.payload.inviteId));
    expect(await sendInvitation(payloadOf(row), deps, { store: mem.store })).toBe('skipped');
    expect([auth.links.length, deps.mail.sent.length]).toEqual([1, 0]);
  });

  it('bans the Auth user and sends nothing when the person is turned off while the link is made', async () => {
    const { deps, auth, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    // The first read sees the person on; users.deactivate commits before the second read.
    mem.reads.push(() => undefined, (p) => void (p!.user = person({ active: false })));
    expect(await sendInvitation(payloadOf(inviteRow('usr_012')), deps, { store: mem.store })).toBe('skipped');
    expect(auth.links).toHaveLength(1);
    expect(auth.users.get(auth.links[0].authUserId)!.banned).toBe(true);
    expect(deps.mail.sent).toEqual([]);
  });

  it('sends nothing again once the mail went out (a retry after the done mark failed)', async () => {
    const { deps, auth, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    const row = inviteRow('usr_012');
    await sendInvitation(payloadOf(row), deps, { store: mem.store });
    expect(await sendInvitation(payloadOf(row), deps, { store: mem.store })).toBe('already');
    expect([auth.links.length, deps.mail.sent.length]).toEqual([1, 1]);
  });

  it('sends a recovery link when the person already accepted (invite gives email_exists), still to Welcome', async () => {
    const { deps, auth, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    const first = await auth.generateLink('invite', 'sara@madar.test');
    auth.accept(first.authUserId);
    mem.byId.get('usr_012')!.authUserId = first.authUserId;
    await sendInvitation(payloadOf(inviteRow('usr_012')), deps, { store: mem.store });
    expect(auth.links.map((l) => l.type)).toEqual(['invite', 'recovery']);
    expect(linkIn(deps.mail.sent[0].text)).toBe(`https://madar.test/welcome?token_hash=${auth.links[1].tokenHash}&type=recovery`);
    // The same Auth user: the link does not change, so setAuthUserId does not run.
    expect(mem.relinks).toEqual([]);
  });

  it('sends nothing for a turned-off person, an agent, or a person who is gone', async () => {
    const { deps, auth, mem, payloadOf } = setup([
      { user: person({ id: 'usr_013', active: false }), authUserId: null },
      { user: person({ id: 'usr_014', kind: 'agent', ownerId: 'usr_001' }), authUserId: null },
    ]);
    for (const id of ['usr_013', 'usr_014', 'usr_404']) expect(await sendInvitation(payloadOf(inviteRow(id)), deps, { store: mem.store })).toBe('skipped');
    expect([auth.links.length, deps.mail.sent.length]).toEqual([0, 0]);
  });

  it('refuses a payload with no user or invite id: a wiring bug, so the row stays failed for the Admin', async () => {
    const { deps, mem } = setup([]);
    await expect(sendInvitation({ userId: 'usr_012' }, deps, { store: mem.store })).rejects.toThrow(/payload/);
  });
});
