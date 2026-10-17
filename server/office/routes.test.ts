import { describe, expect, it } from 'vitest';
import type { WireResponse } from '../../src/api/remote/wire';
import { importSigninRows } from '../auth/own/import';
import { hashPassword } from '../auth/own/password';
import { ownIssuer } from '../auth/ownKeys';
import { httpOf, nodeOffice } from './test/nodeOffice';

/**
 * The /api and /mcp routes of the office path in node (exit wave 4, Task 1 under the ruling of the main session): each request
 * goes through the real Worker routes (server/entries/officeWorker.ts with server/entries/officeSignin.ts) into the merged methods
 * of the object (signin, mailRoute, mailWork, mcp, batch) on node:sqlite. The test helper server/office/test/nodeOffice.ts wires
 * them as server/entries/officeEntry.ts and server/office/office.ts do.
 */

const AUTH_ID = '11111111-1111-4111-8111-111111111111';
const PASSWORD = 'Office-pass-1';

/**
 * The sample office with one sign-in row for usr_001, with the email of that person (the forgot route finds the person by it).
 * The hash is made before the transaction (no crypto.subtle inside one).
 */
async function signedOffice(at?: string) {
  const t = await nodeOffice(at ? { at } : {});
  const { email } = t.raw.prepare("select json_extract(doc, '$.email') as email from users where id = 'usr_001'").get() as { email: string };
  const hash = await hashPassword(PASSWORD);
  await t.parts.db.tx('write', (q) => importSigninRows(q, [{ id: AUTH_ID, email, password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' }], t.clock.now()));
  return { ...t, email };
}

describe('the routes of the office path, from the Worker into the object (server/office/test/nodeOffice.ts)', () => {
  it('signs in with POST /api/auth/token and gives a token of 15 minutes', async () => {
    const t = await signedOffice();
    const answer = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: t.email, password: PASSWORD }));
    expect(answer.status).toBe(200);
    const body = JSON.parse(answer.body) as { access_token?: string; expires_in?: number; refresh_token?: string };
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    expect(body.expires_in).toBe(900);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const t = await signedOffice();
    const wrong = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: t.email, password: 'not-the-password' }));
    const unknown = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'nobody@madar.test', password: PASSWORD }));
    expect(wrong.status).not.toBe(200);
    expect([wrong.status, wrong.body]).toEqual([unknown.status, unknown.body]);
  });

  it('runs a batch with the token of a sign-in: the Worker checks the own token, and the object finds the person', async () => {
    // The Worker checks the token against the real time, so this office runs at the real time.
    const t = await signedOffice(new Date().toISOString());
    const signin = JSON.parse((await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: t.email, password: PASSWORD }))).body) as { access_token: string };
    const answer = await t.route(httpOf('POST', '/api/batch', { v: 1, calls: [{ i: 0, name: 'session.get', input: {} }] }, { authorization: `Bearer ${signin.access_token}` }));
    expect(answer.status).toBe(200);
    const wire = JSON.parse(answer.body) as WireResponse;
    expect(wire.results[0]).toMatchObject({ i: 0, ok: true });
  });

  it('runs the forgot route in the object: it waits 1,500 ms and puts the reset mail into mail_outbox', async () => {
    const t = await signedOffice();
    const started = Date.now();
    const answer = await t.route(httpOf('POST', '/api/auth/forgot', { email: t.email }));
    expect(answer.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
    const mails = await t.parts.db.statement<{ tag: string; to_email: string }>('read', 'select tag, to_email from mail_outbox');
    expect(mails).toEqual([{ tag: 'reset', to_email: t.email }]);
  });

  it('answers POST /mcp with no token with 401 and the challenge of the own server', async () => {
    const t = await signedOffice();
    const answer = await t.route(httpOf('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(answer.status).toBe(401);
    expect(new Headers(answer.headers).get('www-authenticate')).toMatch(/^Bearer /);
  });

  it('gives the discovery document of the own issuer under /mcp', async () => {
    const t = await signedOffice();
    const answer = await t.route(httpOf('GET', '/mcp/.well-known/oauth-authorization-server'));
    expect(answer.status).toBe(200);
    expect((JSON.parse(answer.body) as { issuer: string }).issuer).toBe(ownIssuer('https://madar.test/mcp'));
  });

  it('with no sign-in key: /api/auth/* does not exist, /mcp answers 503, and the log names the secret and no value', async () => {
    const t = await nodeOffice({ env: { MADAR_AUTH_PRIVATE_JWK: '' } });
    const token = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'nobody@madar.test', password: PASSWORD }));
    expect(token.status).toBe(404);
    expect(token.body).toContain('not_found');
    const mcp = await t.route(httpOf('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(mcp.status).toBe(503);
    expect(t.lines.some((line) => line.includes('MADAR_AUTH_PRIVATE_JWK'))).toBe(true);
  });

  it('removes in the first Cron run after 00:00 UTC the sign-in links that ended more than a day ago, and keeps a new one', async () => {
    const t = await signedOffice('2026-10-05T00:05:00.000Z');
    t.raw.exec(`insert into auth_links (token_hash, auth_id, type, expires_at) values ('old', '${AUTH_ID}', 'recovery', '2026-10-03T00:00:00.000Z'), ('new', '${AUTH_ID}', 'recovery', '2026-10-05T01:00:00.000Z')`);
    await t.parts.cron({ at: '2026-10-05T00:05:00.000Z', worker: 0 }, t.net);
    expect(t.raw.prepare('select token_hash from auth_links order by token_hash').all()).toEqual([{ token_hash: 'new' }]);
    t.raw.exec(`insert into auth_links (token_hash, auth_id, type, expires_at) values ('old2', '${AUTH_ID}', 'recovery', '2026-10-03T00:00:00.000Z')`);
    await t.parts.cron({ at: '2026-10-05T06:00:00.000Z', worker: 0 }, t.net);
    expect(t.raw.prepare("select count(*) as n from auth_links where token_hash = 'old2'").get()).toEqual({ n: 1 });
  });
});
