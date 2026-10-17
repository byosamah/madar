import { describe, expect, it } from 'vitest';
import { runInHost } from '../../core/after';
import type { Deps } from '../../core/ports';
import { createForgotRoute } from '../forgot';
import { createRenewRoute } from '../renew';
import { addSignIn, linkValueOfMail, signinOffice } from './testOffice';

const post = (path: string, body: unknown, address = '203.0.113.7') =>
  new Request(`http://madar.test/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-madar-client-address': address }, body: JSON.stringify(body) });
const tokenOfMail = (html: string) => linkValueOfMail(html, 'token_hash');
const renewOfMail = (html: string) => linkValueOfMail(html, 'renew');

describe('the forgot and renew routes on SQLite (Supabase exit, wave 2)', () => {
  it('sends a reset mail with a recovery link to a person with a sign-in row, and the same answer for an unknown email', async () => {
    const t = await signinOffice();
    await addSignIn(t, 'usr_002', { password: 'a good password' });
    const email = (t.raw.prepare('select email from auth_users').get() as { email: string }).email;
    const route = createForgotRoute({ minMs: 0, host: () => ({ host: 'workers' }) });
    const known = await runInHost({ host: 'workers' }, () => route(post('/auth/forgot', { email }), t.deps as unknown as Deps));
    const unknown = await runInHost({ host: 'workers' }, () => route(post('/auth/forgot', { email: 'nobody@madar.test' }), t.deps as unknown as Deps));
    expect([known.status, await known.json(), unknown.status, await unknown.json()]).toEqual([200, { v: 1, ok: true }, 200, { v: 1, ok: true }]);
    expect(t.deps.mail.sent.map((mail) => mail.to)).toEqual([email]);
    expect(t.deps.mail.sent[0].html).toContain('/reset?token_hash=');
    expect(t.raw.prepare('select type from auth_links where used_at is null').all()).toEqual([{ type: 'recovery' }]);
  });

  it('counts the limits of the address that the Pages Function wrote, and of the email, in rate_limits', async () => {
    const t = await signinOffice();
    await addSignIn(t, 'usr_002', { password: 'a good password' });
    const route = createForgotRoute({ minMs: 0, host: () => ({ host: 'workers' }) });
    const answers: number[] = [];
    for (let i = 0; i < 4; i += 1) answers.push((await runInHost({ host: 'workers' }, () => route(post('/auth/forgot', { email: 'x@madar.test' }), t.deps as unknown as Deps))).status);
    expect(answers).toEqual([200, 200, 200, 429]);
    expect(t.raw.prepare('select count(*) as n from rate_limits').get()).toEqual({ n: 2 });
    expect(JSON.stringify(t.raw.prepare('select key from rate_limits').all())).not.toContain('x@madar.test');
  });

  it('renews an invitation with the key of the mail once, and a second press sends nothing', async () => {
    const t = await signinOffice();
    const userId = ((await t.call('usr_001', 'users.create', { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' })) as { output: { id: string } }).output.id;
    const key = renewOfMail(t.deps.mail.sent[0].html);
    const first = tokenOfMail(t.deps.mail.sent[0].html);
    const route = createRenewRoute({ minMs: 0, host: () => ({ host: 'workers' }) });
    await runInHost({ host: 'workers' }, () => route(post('/auth/renew-invite', { key }), t.deps as unknown as Deps));
    await runInHost({ host: 'workers' }, () => route(post('/auth/renew-invite', { key }), t.deps as unknown as Deps));
    expect(t.deps.mail.sent).toHaveLength(2);
    expect(tokenOfMail(t.deps.mail.sent[1].html)).not.toBe(first);
    expect(t.raw.prepare('select count(*) as n from auth_links where used_at is null').get()).toEqual({ n: 1 });
    expect(t.raw.prepare('select user_id from auth_users').get()).toEqual({ user_id: userId });
  });

  it('does nothing for a plain key that a reader of an unsent outbox row finds (security fix 8)', async () => {
    const t = await signinOffice();
    t.raw.prepare("insert into outbox (kind, payload) values ('auth.invite', ?)").run(JSON.stringify({ userId: 'usr_004', inviteId: 'inv_x', renewKey: 'plainkey', renewKeys: [] }));
    const route = createRenewRoute({ minMs: 0, host: () => ({ host: 'workers' }) });
    const answer = await runInHost({ host: 'workers' }, () => route(post('/auth/renew-invite', { key: 'plainkey' }), t.deps as unknown as Deps));
    expect(answer.status).toBe(200);
    expect(t.deps.mail.sent).toHaveLength(0);
  });
});
