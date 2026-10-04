import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { defaultPreferences } from '../../src/api/contract/entities';
import { memoryMailDb } from '../mail/memoryMailDb';
import { QUOTA_LIMITS } from '../mail/quota';
import { MailSendError } from '../mail/resend';
import { fakeDeps } from '../test/fakes/deps';
import { fakeAuth } from './fakeAuth';
import { INVITE_KIND, inviteRow, RENEW_PARAM, renewRow, sendInvitation, type InviteStore, type Person, type SigninLink } from './invite';
import { hashedKey } from './rateLimit';

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
      const { tokenHash: _gone, renewKey: _key, ...rest } = payloads.get(inviteId) ?? {};
      payloads.set(inviteId, { ...rest, sentAt: at.toISOString(), mailId });
    },
    async keepRenewKey(inviteId, key, hash) {
      // As RENEW_KEY_SQL: a hash that the row already holds is not added again.
      const before = payloads.get(inviteId) ?? {};
      const keys = (before.renewKeys as string[] | undefined) ?? [];
      if (!keys.includes(hash)) payloads.set(inviteId, { ...before, renewKey: key, renewKeys: [...keys, hash] });
    },
  };
  return { store, payloads, relinks, byId, replaced, reads };
}

function setup(people: Person[], o: { db?: ReturnType<typeof memoryMailDb> } = {}) {
  const deps = fakeDeps({ db: o.db?.db, config: { appUrl: 'https://madar.test' } });
  const auth = fakeAuth(deps.authAdmin);
  deps.authAdmin = auth;
  const mem = memoryStore(people);
  /** The payload as the outbox row holds it after the earlier attempts. */
  const payloadOf = (row: { payload: Record<string, unknown> }) => ({ ...row.payload, ...mem.payloads.get(String(row.payload.inviteId)) });
  return { deps, auth, mem, payloadOf };
}

const linkIn = (text: string) => /https:\/\/madar\.test\/\S+/.exec(text)?.[0];
/** The renew key in the Welcome link of a mail (security fix 7), or undefined. */
const renewIn = (text: string) => new URL(linkIn(text) ?? 'https://madar.test/').searchParams.get(RENEW_PARAM) ?? undefined;

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
    // The link also carries the renew key of security fix 7, so the Welcome screen can ask for a new link when this one is out of date.
    const key = renewIn(mail.text)!;
    expect(linkIn(mail.text)).toBe(`https://madar.test/welcome?token_hash=${tokenHash}&type=invite&${RENEW_PARAM}=${key}`);
    expect(mem.payloads.get(String(row.payload.inviteId))).toMatchObject({ linkType: 'invite', sentAt: deps.clock.now().toISOString(), mailId: 'mail_1' });
  });

  it('puts an opaque random renew key in the Welcome link, and keeps only its sha256 (security fix 7)', async () => {
    const { deps, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    const row = inviteRow('usr_012');
    await sendInvitation(payloadOf(row), deps, { store: mem.store });
    const key = renewIn(deps.mail.sent[0].text)!;
    expect(key).toMatch(/^[a-z2-7]{52}$/);
    const payload = mem.payloads.get(String(row.payload.inviteId))!;
    expect(payload.renewKeys).toEqual([await hashedKey('renew', key)]);
    // The key names no person and no email, and the stored row never holds it.
    expect(JSON.stringify(payload)).not.toContain(key);
    expect(key).not.toContain('sara');
  });

  it('makes the renew key at random, so the invite id and the token hash do not give it back (security fix 8)', async () => {
    // Two runs send the same invitation row, and the fake Auth gives both the same token hash. A key made from the link
    // would come out the same; a reader of the outbox could then rebuild the token hash from the 1 million Auth codes.
    const row = inviteRow('usr_012');
    const keys: string[] = [];
    for (const _run of [1, 2]) {
      const { deps, auth, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
      await sendInvitation(payloadOf(row), deps, { store: mem.store });
      expect(auth.links[0].tokenHash).toBe('hash_1');
      keys.push(renewIn(deps.mail.sent[0].text)!);
    }
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('keeps the renew key in the unsent row next to the token hash, so a retry mails it, and the sent row holds neither (security fix 8)', async () => {
    const { deps, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    const row = inviteRow('usr_012');
    deps.mail.failNext(new Error('Resend is down'));
    await expect(sendInvitation(payloadOf(row), deps, { store: mem.store })).rejects.toThrow('Resend is down');
    const unsent = mem.payloads.get(String(row.payload.inviteId))!;
    expect(unsent).toMatchObject({ tokenHash: 'hash_1', renewKey: expect.stringMatching(/^[a-z2-7]{52}$/) });
    expect(unsent.renewKeys).toEqual([await hashedKey('renew', String(unsent.renewKey))]);
    await sendInvitation(payloadOf(row), deps, { store: mem.store });
    expect(renewIn(deps.mail.sent[0].text)).toBe(unsent.renewKey);
    const sent = mem.payloads.get(String(row.payload.inviteId))!;
    expect(sent).not.toHaveProperty('tokenHash');
    expect(sent).not.toHaveProperty('renewKey');
  });

  it('a retry after a failed send mails the same renew key and keeps one sha256', async () => {
    const { deps, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    const row = inviteRow('usr_012');
    deps.mail.failNext(new Error('Resend is down'));
    await expect(sendInvitation(payloadOf(row), deps, { store: mem.store })).rejects.toThrow('Resend is down');
    await sendInvitation(payloadOf(row), deps, { store: mem.store });
    const key = renewIn(deps.mail.sent[0].text)!;
    expect(mem.payloads.get(String(row.payload.inviteId))!.renewKeys).toEqual([await hashedKey('renew', key)]);
  });

  it('a retry after a send that went out but lost its answer sends the same mail, so Resend gives the first answer and the row is marked as sent', async () => {
    const { deps, mem, payloadOf } = setup([{ user: person(), authUserId: null }]);
    // The Resend rule (outboxMailPort keeps it too): the same idempotency key with another mail is refused, 409 and not retryable.
    const bodies = new Map<string, string>();
    let lost = true;
    deps.mail.send = async (mail) => {
      const body = JSON.stringify([mail.to, mail.subject, mail.html, mail.text]);
      const seen = bodies.get(mail.idempotencyKey);
      if (seen !== undefined && seen !== body) {
        throw new MailSendError('The idempotency key came back with another mail.', { status: 409, code: 'invalid_idempotent_request', retryable: false });
      }
      bodies.set(mail.idempotencyKey, body);
      deps.mail.sent.push(mail);
      if (lost) {
        lost = false;
        throw new MailSendError('Resend did not answer in 10000 ms.', { status: null, code: 'timeout', retryable: true });
      }
      return { id: 'mail_1' };
    };
    const row = inviteRow('usr_012');
    await expect(sendInvitation(payloadOf(row), deps, { store: mem.store })).rejects.toThrow(/did not answer/);
    expect(await sendInvitation(payloadOf(row), deps, { store: mem.store })).toBe('sent');
    const payload = mem.payloads.get(String(row.payload.inviteId))!;
    expect(payload).toMatchObject({ sentAt: deps.clock.now().toISOString(), mailId: 'mail_1' });
    expect(payload).not.toHaveProperty('tokenHash');
    expect(deps.mail.sent[1].text).toBe(deps.mail.sent[0].text);
    expect(payload.renewKeys).toEqual([await hashedKey('renew', renewIn(deps.mail.sent[0].text)!)]);
  });

  it('a renewal row counts its mail against the daily mail quota as sign-in mail, and a full day keeps the row for the job', async () => {
    const db = memoryMailDb();
    const { deps, mem, payloadOf } = setup([{ user: person(), authUserId: null }], { db });
    const row = renewRow('usr_012');
    expect(row).toMatchObject({ kind: INVITE_KIND, payload: { userId: 'usr_012', counted: true } });
    expect(await sendInvitation(payloadOf(row), deps, { store: mem.store })).toBe('sent');
    expect(db.log.map((r) => [r.kind, r.user_id, r.ref, r.resend_id])).toEqual([['signin', 'usr_012', `invite:${row.payload.inviteId}`, 'mail_1']]);
    // A full day: the mail does not go out, and the row stays for the job (it throws).
    db.fill('notice', QUOTA_LIMITS.signin, deps.clock.now().toISOString().slice(0, 10));
    const second = renewRow('usr_012');
    await expect(sendInvitation(payloadOf(second), deps, { store: mem.store })).rejects.toThrow(/quota/);
    expect(deps.mail.sent).toHaveLength(1);
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
    // A person who accepted gets no renew key: Madar never renews an accepted invitation (security fix 7).
    expect(renewIn(deps.mail.sent[0].text)).toBeUndefined();
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
