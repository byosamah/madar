import { describe, expect, it } from 'vitest';
import { makeWorld } from '../../src/test/factories';
import type { SigninExportRow } from '../auth/own/import';
import { nodeWorld } from '../office/test/nodeWorld';
import { openFor } from '../office/test/fakes';
import type { EnterpriseInit } from './types';

const ENT = 'ent_002';
const signin = (userId: string, id = `auth-${userId}`): SigninExportRow => ({
  id, email: `${userId}@acme.test`, password_hash: null, email_confirmed: true, banned: false, password_set: true, user_id: userId,
});

/** An enterprise of the small test office (usr_001 Admin, usr_002 to usr_004 people, usr_005 an agent) with a sign-in row for each person. */
async function world() {
  const state = makeWorld();
  state.users.usr_004!.active = false;
  const w = await nodeWorld({ ents: [ENT], seeds: { [ENT]: state } });
  await w.signins([signin('usr_001'), signin('usr_002'), signin('usr_003'), signin('usr_004'), signin('usr_005')], ENT);
  return { w, one: w.ents.get(ENT)! };
}
const sessionOf = async (w: Awaited<ReturnType<typeof world>>['w'], authUserId: string) => {
  const out = await w.ents.get(ENT)!.stub.batch({ ent: ENT, who: { kind: 'browser', authUserId }, calls: [{ i: 0, name: 'session.get', input: {} }], overviewCalls: 0, worker: 0 }, w.net);
  if (!out.ok) return out;
  return JSON.parse(out.body).results[0] as { ok: boolean; output?: Record<string, unknown> };
};

describe('setState', () => {
  it('closes every socket on pause, refuses a batch with enterprise_paused, and lets the batch run again after resume', async () => {
    const { w, one } = await world();
    const socket = openFor(one.sockets, 'usr_001', 0);
    await one.stub.setState({ ent: ENT, state: 'paused' });
    expect(socket.closed).toEqual({ code: 1012, reason: 'Paused.' });
    const refused = await sessionOf(w, 'auth-usr_001');
    expect(refused).toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'enterprise_paused' } } });
    expect(one.parts.facts.state()).toBe('paused');
    await one.stub.setState({ ent: ENT, state: 'active' });
    expect(await sessionOf(w, 'auth-usr_001')).toMatchObject({ ok: true });
  });

  it('refuses a socket that opens on a paused object', async () => {
    const { one } = await world();
    const { ticket } = one.parts.tickets.mint('usr_001', new Date());
    await one.stub.setState({ ent: ENT, state: 'paused' });
    const answer = await one.stub.fetch(new Request(`https://office.internal/live?ticket=${ticket}`, { headers: { upgrade: 'websocket' } }));
    expect(answer.status).toBe(401);
  });

  it('refuses another id and the state creating', async () => {
    const { one } = await world();
    await expect(one.stub.setState({ ent: 'ent_009', state: 'paused' })).rejects.toThrow();
    await expect(one.stub.setState({ ent: ENT, state: 'creating' })).rejects.toThrow();
  });
});

describe('setLimits', () => {
  it('changes the facts, and a settings.update with a limits field leaves them as they were', async () => {
    const { w, one } = await world();
    await one.stub.setLimits({ ent: ENT, limits: { people: 7, storageBytes: 5000 } });
    expect(one.parts.facts.limits()).toEqual({ people: 7, storageBytes: 5000 });
    expect(one.raw.prepare('select limits from enterprise').get()).toEqual({ limits: '{"people":7,"storageBytes":5000}' });
    await one.stub.batch({
      ent: ENT, who: { kind: 'browser', authUserId: 'auth-usr_001' }, overviewCalls: 0, worker: 0,
      calls: [{ i: 0, name: 'settings.update', input: { workloadLimit: 9, limits: { people: 1, storageBytes: 1 } } }],
    }, w.net);
    expect(one.parts.facts.limits()).toEqual({ people: 7, storageBytes: 5000 });
    expect(one.raw.prepare('select limits from enterprise').get()).toEqual({ limits: '{"people":7,"storageBytes":5000}' });
  });
});

describe('setIdentity and the platform owner flag', () => {
  it('shows the new name and logo in the next session.get', async () => {
    const { w, one } = await world();
    const logo = 'data:image/png;base64,AAAA';
    await one.stub.setIdentity({ ent: ENT, name: 'Acme Co', nameAr: 'أكمي', logo });
    const got = await sessionOf(w, 'auth-usr_001');
    expect(got).toMatchObject({ ok: true, output: { enterprise: { id: ENT, name: 'Acme Co', nameAr: 'أكمي', logo } } });
    await one.stub.setIdentity({ ent: ENT, name: 'Acme Co', nameAr: 'أكمي', logo: null });
    expect(await sessionOf(w, 'auth-usr_001')).toMatchObject({ output: { enterprise: { logo: null } } });
  });

  it('session.get never shows platformOwner: the platform has its own accounts (design D9)', async () => {
    const { w } = await world();
    for (const auth of ['auth-usr_001', 'auth-usr_002']) {
      expect((await sessionOf(w, auth) as { output: Record<string, unknown> }).output).not.toHaveProperty('platformOwner');
    }
  });

  it('the object has no owner list any more: no RPC method for it, and enterprise_use.owners stays at its default', async () => {
    const { one } = await world();
    expect(one.stub).not.toHaveProperty('setPlatformOwners');
    expect(one.stub).not.toHaveProperty('person');
    expect(one.raw.prepare('select owners from enterprise_use').get()).toEqual({ owners: '[]' });
  });
});

describe('reinvite', () => {
  const init = (): EnterpriseInit => ({
    ent: ENT, address: 'acme-co', name: 'Acme Co', nameAr: 'أكمي', logo: null, limits: { people: null, storageBytes: null }, codePrefix: 'AC',
    admin: { name: 'Sara', email: 'sara@acme.test', language: 'en' },
  });
  async function made() {
    const w = await nodeWorld({ ents: [ENT], seeds: { [ENT]: false }, row: false });
    const one = w.ents.get(ENT)!;
    await one.stub.init(init(), w.net);
    return { w, one };
  }
  const invites = (one: Awaited<ReturnType<typeof made>>['one']) => (one.raw.prepare("select count(*) as n from outbox where kind = 'auth.invite'").get() as { n: number }).n;

  it('queues one new invitation and sends the mail again', async () => {
    const { w, one } = await made();
    expect(invites(one)).toBe(1);
    const out = await one.stub.reinvite({ ent: ENT }, w.net);
    expect(out).toMatchObject({ ok: true, value: { sentAt: expect.any(String) } });
    expect(invites(one)).toBe(2);
    expect((one.raw.prepare("select count(*) as n from mail_outbox where tag = 'invite'").get() as { n: number }).n).toBe(2);
  });

  it('refuses with already_accepted after the Admin set a password', async () => {
    const { w, one } = await made();
    one.raw.exec('update auth_users set password_set = 1');
    expect(await one.stub.reinvite({ ent: ENT }, w.net)).toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'already_accepted' } } });
    expect(invites(one)).toBe(1);
  });

  it('refuses the sixth call of a day with invite_limit', async () => {
    const { w, one } = await made();
    for (let i = 0; i < 5; i += 1) expect(await one.stub.reinvite({ ent: ENT }, w.net)).toMatchObject({ ok: true });
    expect(await one.stub.reinvite({ ent: ENT }, w.net)).toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'invite_limit' } } });
    expect(invites(one)).toBe(6);
  });
});
