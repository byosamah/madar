import { describe, expect, it } from 'vitest';
import { makeWorld } from '../../src/test/factories';
import type { Deps } from '../core/ports';
import type { SigninExportRow } from '../auth/own/import';
import { nodeWorld } from '../office/test/nodeWorld';
import { usersCreateHooks, usersRemoveHooks, usersUpdateHooks } from './peopleHooks';

const ENT = 'ent_002';
const row = (userId: string): SigninExportRow => ({ id: `auth-${userId}`, email: `${userId}@madar.test`, password_hash: null, email_confirmed: true, banned: false, password_set: true, user_id: userId });

async function world() {
  const state = makeWorld();
  const w = await nodeWorld({ ents: ['ent_001', ENT], seeds: { ent_001: false, [ENT]: state } });
  await w.signins([row('usr_001'), row('usr_003')], ENT);
  // The directory holds the emails of the people of ent_002, as the real import and the create step reserve them.
  for (const id of ['usr_001', 'usr_002', 'usr_003', 'usr_004']) await w.platform.reserveEmail({ ent: ENT, email: `${id}@madar.test` });
  const one = w.ents.get(ENT)!;
  const run = async (authUserId: string, name: string, input: unknown, key?: string) => {
    const out = await one.stub.batch({ ent: ENT, who: { kind: 'browser', authUserId }, calls: [{ i: 0, name, input, ...(key ? { key } : {}) }], overviewCalls: 0, worker: 0 }, w.netFor(ENT));
    if (!out.ok) throw new Error(`The batch was refused: ${out.error.message}`);
    return JSON.parse(out.body).results[0] as { ok: boolean; output?: Record<string, any>; error?: { code: string; message: string; details?: Record<string, unknown> } };
  };
  const who = (email: string) => w.platform.resolveEmail({ email });
  return { w, one, run, who };
}
const NEW = { name: 'Nour', email: 'nour@acme.test', discipline: 'Architect', systemRole: 'member' };

describe('users.create and the directory', () => {
  it('reserves a new email once and creates the person', async () => {
    const t = await world();
    const done = await t.run('auth-usr_001', 'users.create', NEW);
    expect(done.ok).toBe(true);
    expect(await t.who('nour@acme.test')).toEqual({ ent: ENT });
  });

  it('refuses an email of another enterprise with email_taken, and the text names no enterprise', async () => {
    const t = await world();
    await t.w.platform.reserveEmail({ ent: 'ent_001', email: 'nour@acme.test' });
    const refused = await t.run('auth-usr_001', 'users.create', NEW);
    expect(refused).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'email_taken' } } });
    expect(JSON.stringify(refused)).not.toMatch(/ent_00/);
    expect(await t.who('nour@acme.test')).toEqual({ ent: 'ent_001' });
    expect(Object.keys((t.one.raw.prepare("select count(*) as n from users where json_extract(doc, '$.email') = 'nour@acme.test'").get() as object))).toEqual(['n']);
  });

  it('keeps A@X.com and a@x.com as one email', async () => {
    const t = await world();
    await t.w.platform.reserveEmail({ ent: 'ent_001', email: 'a@x.test' });
    const refused = await t.run('auth-usr_001', 'users.create', { ...NEW, email: 'A@X.test' });
    expect(refused).toMatchObject({ ok: false, error: { details: { reason: 'email_taken' } } });
  });

  it('touches the directory for no Member: a refused create (forbidden) reserves nothing and probes nothing', async () => {
    const t = await world();
    await t.w.platform.reserveEmail({ ent: 'ent_001', email: 'taken@x.test' });
    const probe = await t.run('auth-usr_003', 'users.create', { ...NEW, email: 'taken@x.test' });
    // The Member gets the refusal of the right, not the answer of the directory.
    expect(probe).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const plain = await t.run('auth-usr_003', 'users.create', NEW);
    expect(plain).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await t.who('nour@acme.test')).toBeNull();
  });

  it('reserves nothing for an email that a person of the enterprise holds, and a failure releases nothing', async () => {
    const t = await world();
    const refused = await t.run('auth-usr_001', 'users.create', { ...NEW, email: 'usr_002@madar.test' });
    expect(refused).toMatchObject({ ok: false, error: { details: { reason: 'email_taken' } } });
    expect(await t.who('usr_002@madar.test')).toEqual({ ent: ENT });
  });

  it('keeps the email when a racing write committed it: the settle of a failed create re-checks the rows', async () => {
    const t = await world();
    const deps = t.one.parts.depsFor(t.w.netFor(ENT));
    const pre = await usersCreateHooks.preflight!({ ...NEW, kind: 'human' }, { actorId: 'usr_001', now: new Date(), deps });
    expect(pre).toEqual({ reserved: true, email: 'nour@acme.test' });
    // The other create committed the same email first.
    expect((await t.run('auth-usr_001', 'users.create', NEW)).ok).toBe(true);
    await usersCreateHooks.settle!({ ...NEW, kind: 'human' }, { actorId: 'usr_001', now: new Date(), deps }, pre, { ok: false });
    expect(await t.who('nour@acme.test')).toEqual({ ent: ENT });
  });

  it('releases the reserve when no person holds the email after a failed create', async () => {
    const t = await world();
    const deps = t.one.parts.depsFor(t.w.netFor(ENT));
    const pre = await usersCreateHooks.preflight!({ ...NEW, kind: 'human' }, { actorId: 'usr_001', now: new Date(), deps });
    expect(await t.who('nour@acme.test')).toEqual({ ent: ENT });
    await usersCreateHooks.settle!({ ...NEW, kind: 'human' }, { actorId: 'usr_001', now: new Date(), deps }, pre, { ok: false });
    expect(await t.who('nour@acme.test')).toBeNull();
  });

  it('reserves nothing for an agent', async () => {
    const t = await world();
    const done = await t.run('auth-usr_001', 'users.create', { name: 'Helper', email: 'helper@acme.test', discipline: 'Agent', kind: 'agent', ownerId: 'usr_003' });
    expect(done.ok).toBe(true);
    expect(await t.who('helper@acme.test')).toBeNull();
  });
});

describe('users.update, users.remove and users.deactivate', () => {
  it('reserves the new email and frees the old one after the change', async () => {
    const t = await world();
    const done = await t.run('auth-usr_001', 'users.update', { id: 'usr_004', patch: { email: 'omar@new.test' } });
    expect(done.ok).toBe(true);
    expect(await t.who('omar@new.test')).toEqual({ ent: ENT });
    expect(await t.who('usr_004@madar.test')).toBeNull();
  });

  it('refuses a new email of another enterprise with email_taken and keeps the old one', async () => {
    const t = await world();
    await t.w.platform.reserveEmail({ ent: 'ent_001', email: 'omar@new.test' });
    const refused = await t.run('auth-usr_001', 'users.update', { id: 'usr_004', patch: { email: 'omar@new.test' } });
    expect(refused).toMatchObject({ ok: false, error: { details: { reason: 'email_taken' } } });
    expect(await t.who('usr_004@madar.test')).toEqual({ ent: ENT });
    expect(await t.who('omar@new.test')).toEqual({ ent: 'ent_001' });
  });

  it('frees the new email after a refused change, and not an email that another person holds', async () => {
    const t = await world();
    // The patch also asks for a role change that the handler refuses (a custom role needs a Member): the whole call fails.
    const refused = await t.run('auth-usr_001', 'users.update', { id: 'usr_004', patch: { email: 'omar@new.test', systemRole: 'admin', roleId: 'rol_999' } });
    expect(refused.ok).toBe(false);
    expect(await t.who('omar@new.test')).toBeNull();
    expect(await t.who('usr_004@madar.test')).toEqual({ ent: ENT });
    // The new email is the email of another person of this enterprise: the handler refuses, and the directory keeps it.
    const same = await t.run('auth-usr_001', 'users.update', { id: 'usr_004', patch: { email: 'usr_002@madar.test' } });
    expect(same).toMatchObject({ ok: false, error: { details: { reason: 'email_taken' } } });
    expect(await t.who('usr_002@madar.test')).toEqual({ ent: ENT });
  });

  it('gives a Member who may not change an email no answer of the directory', async () => {
    const t = await world();
    await t.w.platform.reserveEmail({ ent: 'ent_001', email: 'omar@new.test' });
    const refused = await t.run('auth-usr_003', 'users.update', { id: 'usr_004', patch: { email: 'omar@new.test' } });
    expect(refused).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('frees the email of a removed person, and users.deactivate frees nothing', async () => {
    const t = await world();
    expect((await t.run('auth-usr_001', 'users.deactivate', { id: 'usr_004' })).ok).toBe(true);
    expect(await t.who('usr_004@madar.test')).toEqual({ ent: ENT });
    expect((await t.run('auth-usr_001', 'users.remove', { id: 'usr_004' })).ok).toBe(true);
    expect(await t.who('usr_004@madar.test')).toBeNull();
  });
});

describe('the directory equals the rows after an update, a replay and a removal', () => {
  const OLD = 'usr_004@madar.test';

  it('keeps the email of the row when a replayed users.update asks for an email that the person already left', async () => {
    const t = await world();
    const first = { id: 'usr_004', patch: { email: 'omar@new.test' } };
    expect((await t.run('auth-usr_001', 'users.update', first, 'key-mail')).ok).toBe(true);
    expect((await t.run('auth-usr_001', 'users.update', { id: 'usr_004', patch: { email: 'omar@third.test' } })).ok).toBe(true);
    // The replay returns the stored answer and writes nothing. The row keeps the third email.
    expect((await t.run('auth-usr_001', 'users.update', first, 'key-mail')).ok).toBe(true);
    expect(await t.who('omar@third.test')).toEqual({ ent: ENT });
    expect(await t.who('omar@new.test')).toBeNull();
    expect(await t.who(OLD)).toBeNull();
  });

  it('keeps the email when users.update leaves it the same, also with other letters', async () => {
    const t = await world();
    const done = await t.run('auth-usr_001', 'users.update', { id: 'usr_004', patch: { email: 'USR_004@madar.test', name: 'Omar' } });
    expect(done.ok).toBe(true);
    expect(await t.who(OLD)).toEqual({ ent: ENT });
  });

  it('frees nothing old and the new email when the committed row still holds the old email', async () => {
    const t = await world();
    const deps = t.one.parts.depsFor(t.w.netFor(ENT));
    const input = { id: 'usr_004', patch: { email: 'omar@new.test' } };
    const pre = await usersUpdateHooks.preflight!(input, { actorId: 'usr_001', now: new Date(), deps });
    expect(pre).toEqual({ reserved: 'omar@new.test', release: OLD });
    // The write ended ok, but the row did not take the new email.
    await usersUpdateHooks.settle!(input, { actorId: 'usr_001', now: new Date(), deps }, pre, { ok: true, output: {} });
    expect(await t.who(OLD)).toEqual({ ent: ENT });
    expect(await t.who('omar@new.test')).toBeNull();
  });

  it('frees the new email of a replay, and not the old one', async () => {
    const t = await world();
    const deps = t.one.parts.depsFor(t.w.netFor(ENT));
    const input = { id: 'usr_004', patch: { email: 'omar@new.test' } };
    const pre = await usersUpdateHooks.preflight!(input, { actorId: 'usr_001', now: new Date(), deps });
    await usersUpdateHooks.settle!(input, { actorId: 'usr_001', now: new Date(), deps }, pre, { ok: true, output: {}, replayed: true });
    expect(await t.who(OLD)).toEqual({ ent: ENT });
    expect(await t.who('omar@new.test')).toBeNull();
  });

  it('keeps both emails right after a change that fails after the reserve', async () => {
    const t = await world();
    const deps = t.one.parts.depsFor(t.w.netFor(ENT));
    const input = { id: 'usr_004', patch: { email: 'omar@new.test' } };
    const pre = await usersUpdateHooks.preflight!(input, { actorId: 'usr_001', now: new Date(), deps });
    await usersUpdateHooks.settle!(input, { actorId: 'usr_001', now: new Date(), deps }, pre, { ok: false });
    expect(await t.who(OLD)).toEqual({ ent: ENT });
    expect(await t.who('omar@new.test')).toBeNull();
  });

  it('frees the old email of a committed change, and keeps the new one', async () => {
    const t = await world();
    expect((await t.run('auth-usr_001', 'users.update', { id: 'usr_004', patch: { email: 'omar@new.test' } }, 'key-ok')).ok).toBe(true);
    expect(await t.who('omar@new.test')).toEqual({ ent: ENT });
    expect(await t.who(OLD)).toBeNull();
  });

  it('frees the email of users.remove only when the row of the person is removed', async () => {
    const t = await world();
    const deps = t.one.parts.depsFor(t.w.netFor(ENT));
    const ctx = { actorId: 'usr_001', now: new Date(), deps };
    const input = { id: 'usr_004' };
    const pre = await usersRemoveHooks.preflight!(input, ctx);
    expect(pre).toBe(OLD);
    // The row is not removed (the write rolled back, or the answer is a replay): the email stays.
    await usersRemoveHooks.settle!(input, ctx, pre, { ok: true, output: {} });
    expect(await t.who(OLD)).toEqual({ ent: ENT });
    await t.run('auth-usr_001', 'users.deactivate', { id: 'usr_004' });
    expect((await t.run('auth-usr_001', 'users.remove', input, 'key-remove')).ok).toBe(true);
    expect(await t.who(OLD)).toBeNull();
    // A replay of the removal frees nothing, also when the directory holds the email again.
    await t.w.platform.reserveEmail({ ent: ENT, email: OLD });
    await usersRemoveHooks.settle!(input, ctx, pre, { ok: true, output: {}, replayed: true });
    expect(await t.who(OLD)).toEqual({ ent: ENT });
  });
});

describe('without a directory', () => {
  it('the three hooks do nothing', async () => {
    const t = await world();
    const deps = { ...t.one.parts.depsFor(t.w.net), directory: undefined } as Deps;
    const ctx = { actorId: 'usr_001', now: new Date(), deps };
    await t.w.platform.reserveEmail({ ent: 'ent_001', email: 'free@x.test' });
    expect(await usersCreateHooks.preflight!({ ...NEW, email: 'free@x.test', kind: 'human' }, ctx)).toEqual({ reserved: false, email: '' });
    expect(await usersUpdateHooks.preflight!({ id: 'usr_004', patch: { email: 'free@x.test' } }, ctx)).toEqual({ reserved: null, release: null });
    expect(await usersRemoveHooks.preflight!({ id: 'usr_004' }, ctx)).toBeNull();
    await usersCreateHooks.settle!({}, ctx, { reserved: true, email: 'a@x.test' }, { ok: false });
    await usersUpdateHooks.settle!({ id: 'usr_004' }, ctx, { reserved: 'a@x.test', release: 'b@x.test' }, { ok: true, output: {} });
    await usersRemoveHooks.settle!({}, ctx, 'a@x.test', { ok: true, output: {} });
    expect(await t.who('free@x.test')).toEqual({ ent: 'ent_001' });
  });
});
