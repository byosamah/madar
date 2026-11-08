import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../../src/data/seed';
import { httpOf, NODE_TODAY, nodeWorld } from '../../office/test/nodeWorld';
import { hashPassword } from './password';

const ENT = 'ent_002';
const PASSWORD = 'a good password';

async function world() {
  // The Worker checks each token against the real time, so the world runs at the real time.
  const t = await nodeWorld({ at: new Date().toISOString(), ents: [ENT], seeds: { [ENT]: await buildSeed(NODE_TODAY, async () => undefined) }, minMs: { forgot: 0, renew: 0 }, sleep: async () => undefined });
  const hash = await hashPassword(PASSWORD);
  await t.signins([{ id: '22222222-2222-4222-8222-222222222222', email: 'admin@two.test', password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' }], ENT);
  return { t, one: t.ents.get(ENT)! };
}
type World = Awaited<ReturnType<typeof world>>;
const parse = (body: string) => JSON.parse(body) as Record<string, any>;
const token = (t: World['t'], email: string, password: string) => t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email, password }));
const count = (one: World['one'], table: string) => (one.raw.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

describe('a paused enterprise at the sign-in (design 5.8)', () => {
  it('gives enterprise_paused after the right password and makes no session', async () => {
    const { t, one } = await world();
    await one.stub.setState({ ent: ENT, state: 'paused' });
    const before = count(one, 'auth_sessions');
    const answer = await token(t, 'admin@two.test', PASSWORD);
    expect(answer.status).toBe(401);
    expect(parse(answer.body).error).toMatchObject({ code: 'unauthenticated', message: 'Madar is paused for your company. Ask your Admin.', details: { reason: 'enterprise_paused' } });
    expect(count(one, 'auth_sessions')).toBe(before);
  });

  it('gives the usual invalid_credentials for a wrong password and for an unknown email', async () => {
    const { t, one } = await world();
    const activeWrong = parse((await token(t, 'admin@two.test', 'a wrong password')).body);
    const activeUnknown = parse((await token(t, 'nobody@two.test', 'a wrong password')).body);
    await one.stub.setState({ ent: ENT, state: 'paused' });
    const wrong = await token(t, 'admin@two.test', 'a wrong password');
    const unknown = await token(t, 'nobody@two.test', 'a wrong password');
    expect(parse(wrong.body).error.details.reason).toBe('invalid_credentials');
    expect(parse(unknown.body).error.details.reason).toBe('invalid_credentials');
    expect(parse(wrong.body)).toEqual(activeWrong);
    expect(parse(unknown.body)).toEqual(activeUnknown);
  });

  it('answers session_ended for the refresh step and for the link step', async () => {
    const { t, one } = await world();
    const signed = parse((await token(t, 'admin@two.test', PASSWORD)).body);
    await one.stub.setState({ ent: ENT, state: 'paused' });
    const refreshed = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'refresh_token', refresh_token: signed.refresh_token }));
    expect(parse(refreshed.body).error).toMatchObject({ code: 'unauthenticated', details: { reason: 'session_ended' } });
    const verify = await one.stub.signin({ ent: ENT, signin: 'auth.verify', input: { token: 'x'.repeat(40), type: 'invite', address: '203.0.113.7' } });
    expect(verify).toMatchObject({ ok: false, error: { code: 'unauthenticated', details: { reason: 'session_ended' } } });
  });

  it('answers a forgot like an active one and queues no mail and no outbox row', async () => {
    const { t, one } = await world();
    const active = await t.route(httpOf('POST', '/api/auth/forgot', { email: 'admin@two.test' }));
    expect(active.status).toBe(200);
    const mails = count(one, 'mail_outbox');
    const outbox = count(one, 'outbox');
    await one.stub.setState({ ent: ENT, state: 'paused' });
    const paused = await t.route(httpOf('POST', '/api/auth/forgot', { email: 'admin@two.test' }));
    expect(paused.status).toBe(200);
    expect(paused.body).toBe(active.body);
    expect(count(one, 'mail_outbox')).toBe(mails);
    expect(count(one, 'outbox')).toBe(outbox);
    // The mail work of a paused object does nothing either.
    await one.stub.mailWork({ ent: ENT, route: 'forgot', value: 'admin@two.test' }, t.net);
    expect(count(one, 'mail_outbox')).toBe(mails);
  });

  it('signs in with the same password after the resume', async () => {
    const { t, one } = await world();
    await one.stub.setState({ ent: ENT, state: 'paused' });
    expect((await token(t, 'admin@two.test', PASSWORD)).status).toBe(401);
    await one.stub.setState({ ent: ENT, state: 'active' });
    const answer = await token(t, 'admin@two.test', PASSWORD);
    expect(answer.status).toBe(200);
    expect(parse(answer.body).access_token).toBeTruthy();
  });
});
