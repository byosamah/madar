import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { createForgotRoute } from '../auth/forgot';
import { principalOf } from '../auth/principal';
import { verifyBrowserToken } from '../auth/verify';
import { processOutbox } from '../core/effects';
import { runCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { readOffice } from '../data/officeCache';
import { setEnvSource } from '../env';
import { authOf, linkIn, localStack, PASSWORD } from './authStack';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * Suite 4 of TM 7, invitations, on the local stack (plan 5.1; task P2) [Docker]: users.create and users.resendInvite through
 * runCall as madar_server, the auth effects after the commit with the real Auth of the local stack, and the mail in the fake.
 * The links of the mail go to the real Auth, as the Welcome and Reset screens send them.
 */

const stack = localStack();
const auth = authOf(stack, 'p2inv');
let office: ItOffice;
let deps: ReturnType<ItOffice['isolate']>;

const call = (userId: string, name: string, input: unknown) => runCall(deps, { principal: { userId }, name, input, batch: newBatch() });

function okOf<T>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

/** The last mail to this address. */
function mailTo(email: string) {
  const found = [...deps.mail.sent].reverse().find((mail) => mail.to === email);
  if (!found) throw new Error(`No mail to ${email}.`);
  return found;
}

const tokenHashOf = (text: string) => linkIn(text).searchParams.get('token_hash')!;

async function invite(label: string, more: Record<string, unknown> = {}): Promise<{ user: User; email: string }> {
  const email = auth.email(label);
  const user = okOf<User>(await call('usr_001', 'users.create', { name: `Person ${label}`, email, discipline: 'Architect', ...more }));
  return { user, email };
}

/** The Welcome screen: the link gives a session, and the session sets the password. */
async function accept(text: string): Promise<void> {
  const url = linkIn(text);
  const used = await auth.useLink(url.searchParams.get('type')!, url.searchParams.get('token_hash')!);
  expect(used.status).toBe(200);
  expect(await auth.setPassword(auth.tokenOf(used))).toBe(200);
}

beforeAll(async () => {
  setEnvSource({ SUPABASE_URL: stack.apiUrl });
  office = await startOffice('p2inv');
  deps = office.isolate();
  deps.authAdmin = auth.admin as unknown as typeof deps.authAdmin;
}, 60_000);

afterAll(async () => {
  setEnvSource(undefined);
  await auth.cleanup();
  await office?.close();
});

describe('suite 4: invitations on the local stack', () => {
  it('the Admin invites; the mail has a Welcome link; the link sets a password; the person signs in as the new person', async () => {
    const { user, email } = await invite('nora');
    const mail = mailTo(email);
    expect(mail.subject).toBe('Your invitation to Madar');
    const url = linkIn(mail.text);
    expect([url.pathname, url.searchParams.get('type')]).toEqual(['/welcome', 'invite']);
    const [row] = await office.sql<{ auth: string }>('select auth_user_id::text as auth from users where id = $1', [user.id]);
    expect(row.auth).toMatch(/^[0-9a-f-]{36}$/);

    const before = okOf<{ userId: string; state: string; sentAt: string | null }[]>(await call('usr_001', 'users.invites', {})).find((r) => r.userId === user.id);
    expect(before).toMatchObject({ state: 'invited', sentAt: expect.stringMatching(/\+03:00$/) });

    await accept(mail.text);
    const signedIn = await auth.signIn(email);
    expect(signedIn.status).toBe(200);
    const { authUserId } = await verifyBrowserToken(`Bearer ${auth.tokenOf(signedIn)}`);
    expect(authUserId).toBe(row.auth);
    // The warm office cache sees the sign-in link that the effect wrote with setAuthUserId.
    expect(principalOf(authUserId, await readOffice(deps))).toEqual({ userId: user.id });
    const after = okOf<{ userId: string; state: string }[]>(await call('usr_001', 'users.invites', {})).find((r) => r.userId === user.id);
    expect(after?.state).toBe('active');
  });

  it('a Member cannot invite or send an invitation again', async () => {
    const created = await call('usr_002', 'users.create', { name: 'No', email: auth.email('no'), discipline: 'Architect' });
    expect(created).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const resent = await call('usr_002', 'users.resendInvite', { id: 'usr_003' });
    expect(resent).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('refuses a second invitation to the same email', async () => {
    const { email } = await invite('twice');
    const again = await call('usr_001', 'users.create', { name: 'Again', email, discipline: 'Architect' });
    expect(again).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'email_taken' } } });
  });

  it('a new invitation makes the old link fail; the new link works', async () => {
    const { user, email } = await invite('resend');
    const first = tokenHashOf(mailTo(email).text);
    expect(await call('usr_001', 'users.resendInvite', { id: user.id })).toMatchObject({ ok: true });
    const second = tokenHashOf(mailTo(email).text);
    expect(second).not.toBe(first);
    const old = await auth.useLink('invite', first);
    expect([old.status, auth.codeOf(old)]).toEqual([403, 'otp_expired']);
    expect((await auth.useLink('invite', second)).status).toBe(200);
  });

  it('an Arabic person gets the invitation and the reset mail in Arabic, with the feminine forms', async () => {
    const { email } = await invite('arabic', { language: 'ar', gender: 'female' });
    const invitation = mailTo(email);
    expect(invitation.subject).toBe('دعوتك إلى مدار');
    expect(invitation.text).toContain('افتحي الرابط');
    expect(invitation.html).toContain('dir="rtl"');
    await accept(invitation.text);

    const forgot = createForgotRoute({ minMs: 0 });
    const response = await forgot(new Request('http://127.0.0.1/auth/forgot', { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.40' }, body: JSON.stringify({ email }) }), deps);
    expect(response.status).toBe(200);
    const reset = mailTo(email);
    expect(reset.subject).toBe('إعادة تعيين كلمة المرور في مدار');
    expect(reset.text).toContain('إذا لم تطلبي ذلك');
    const url = linkIn(reset.text);
    expect([url.pathname, url.searchParams.get('type')]).toEqual(['/reset', 'recovery']);
    expect((await auth.useLink('recovery', url.searchParams.get('token_hash')!)).status).toBe(200);
  });

  it('a retried auth.invite effect sends the same link, and that link works', async () => {
    deps.mail.failNext(new Error('Resend is down'));
    const { user, email } = await invite('retry');
    const [row] = await office.sql<{ id: string; error: string; payload: { tokenHash: string; sentAt?: string } }>(
      "select id::text as id, error, payload from outbox where kind = 'auth.invite' and payload->>'userId' = $1", [user.id],
    );
    expect(row.error).toContain('Resend is down');
    expect(row.payload.sentAt).toBeUndefined();
    // The job claims a row 2 minutes after the failed attempt.
    await office.sql('update outbox set claimed_until = null where id = $1', [row.id]);
    expect(await processOutbox(deps, [row.id])).toEqual({ done: [row.id], failed: [] });
    expect(tokenHashOf(mailTo(email).text)).toBe(row.payload.tokenHash);
    // A done row keeps no token hash: the hash is a live sign-in credential.
    const [done] = await office.sql<{ payload: Record<string, unknown> }>('select payload from outbox where id = $1', [row.id]);
    expect(done.payload).toMatchObject({ sentAt: expect.any(String), linkType: 'invite' });
    expect(done.payload).not.toHaveProperty('tokenHash');
    await accept(mailTo(email).text);
    expect((await auth.signIn(email)).status).toBe(200);
  });

  it('a retry of an older invitation sends nothing when a newer invitation already made a newer link', async () => {
    deps.mail.failNext(new Error('Resend is down'));
    const { user, email } = await invite('stale');
    const [row] = await office.sql<{ id: string; payload: { tokenHash: string } }>(
      "select id::text as id, payload from outbox where kind = 'auth.invite' and payload->>'userId' = $1", [user.id],
    );
    expect(await call('usr_001', 'users.resendInvite', { id: user.id })).toMatchObject({ ok: true });
    const fresh = tokenHashOf(mailTo(email).text);
    const sent = deps.mail.sent.length;
    await office.sql('update outbox set claimed_until = null where id = $1', [row.id]);
    expect(await processOutbox(deps, [row.id])).toEqual({ done: [row.id], failed: [] });
    expect(deps.mail.sent).toHaveLength(sent);
    expect([(await auth.useLink('invite', row.payload.tokenHash)).status]).toEqual([403]);
    expect((await auth.useLink('invite', fresh)).status).toBe(200);
  });

  it('an email change before the person accepts sends a new invitation to the new email; the link at the old email fails', async () => {
    const { user, email } = await invite('typo');
    const old = tokenHashOf(mailTo(email).text);
    const fixed = auth.email('fixed');
    expect(await call('usr_001', 'users.update', { id: user.id, patch: { email: fixed } })).toMatchObject({ ok: true });
    const mail = mailTo(fixed);
    expect(mail.subject).toBe('Your invitation to Madar');
    // Auth did not confirm the person: the link is an invite link, and the Admin still sees "invited" (the badge and the resend).
    expect([linkIn(mail.text).pathname, linkIn(mail.text).searchParams.get('type')]).toEqual(['/welcome', 'invite']);
    const state = okOf<{ userId: string; state: string }[]>(await call('usr_001', 'users.invites', {})).find((r) => r.userId === user.id);
    expect(state?.state).toBe('invited');
    expect([(await auth.useLink('invite', old)).status]).toEqual([403]);
    await accept(mail.text);
    expect((await auth.signIn(fixed)).status).toBe(200);
  });

  it('a name change writes no auth.email row; an email change writes one', async () => {
    const { user } = await invite('rename');
    const rows = async () => (await office.sql<{ n: string }>("select count(*)::text as n from outbox where kind = 'auth.email' and payload->>'userId' = $1", [user.id]))[0].n;
    expect(await call('usr_001', 'users.update', { id: user.id, patch: { name: 'Person renamed' } })).toMatchObject({ ok: true });
    expect(await rows()).toBe('0');
    expect(await call('usr_001', 'users.update', { id: user.id, patch: { email: auth.email('rename-new') } })).toMatchObject({ ok: true });
    expect(await rows()).toBe('1');
  });

  it('an email change after the person accepted reaches Auth, and only a notice goes to the old email; the person signs in with the new email', async () => {
    const { user, email } = await invite('moved');
    await accept(mailTo(email).text);
    const moved = auth.email('moved-new');
    const sent = deps.mail.sent.length;
    expect(await call('usr_001', 'users.update', { id: user.id, patch: { email: moved } })).toMatchObject({ ok: true });
    expect(deps.mail.sent.slice(sent).map((m) => [m.to, m.subject])).toEqual([[email, 'Your Madar sign-in email changed']]);
    expect(deps.mail.sent[sent].text).toContain(moved);
    // S1: the notice names the Admin, goes through its own outbox row, and counts against the daily mail quota.
    const [admin] = await office.sql<{ name: string }>("select doc->>'name' as name from users where id = 'usr_001'");
    expect(deps.mail.sent[sent].text).toContain(`The change came from ${admin.name}.`);
    const notices = await office.sql<{ done: boolean; to: string }>(
      "select done_at is not null as done, payload->>'to' as to from outbox where kind = 'auth.emailNotice' and payload->>'userId' = $1", [user.id]);
    expect(notices).toEqual([{ done: true, to: email }]);
    const [queued] = await office.sql<{ queued: boolean }>(
      "select (payload->>'noticeQueued')::boolean as queued from outbox where kind = 'auth.email' and payload->>'userId' = $1", [user.id]);
    expect(queued.queued).toBe(true);
    const counted = await office.sql<{ kind: string }>('select kind from mail_log where ref = $1', [deps.mail.sent[sent].idempotencyKey]);
    expect(counted).toEqual([{ kind: 'signin' }]);
    expect((await auth.signIn(moved, PASSWORD)).status).toBe(200);
    const state = okOf<{ userId: string; state: string }[]>(await call('usr_001', 'users.invites', {})).find((r) => r.userId === user.id);
    expect(state?.state).toBe('active');
  });
});
