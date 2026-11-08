import { describe, expect, it } from 'vitest';
import { makeWorld } from '../../src/test/factories';
import { nodeWorld } from '../office/test/nodeWorld';
import { PEOPLE_COUNT_LITE, assertRoomForPerson } from './peopleHooks';

const ENT = 'ent_002';
const NEW = (n: number) => ({ name: `Person ${n}`, email: `p${n}@acme.test`, discipline: 'Architect', systemRole: 'member' });

/** Active humans after the setup: usr_001 Admin, usr_002 and usr_003 (usr_004 is turned off, usr_005 is an agent). With limit 3 the office is full. */
async function world(limit: number | null, edit: (state: ReturnType<typeof makeWorld>) => void = () => undefined) {
  const state = makeWorld();
  state.users.usr_004!.active = false;
  edit(state);
  const w = await nodeWorld({ ents: [ENT], seeds: { [ENT]: state } });
  await w.signins([{ id: 'auth-usr_001', email: 'usr_001@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' }], ENT);
  const one = w.ents.get(ENT)!;
  await one.stub.setLimits({ ent: ENT, limits: { people: limit, storageBytes: null } });
  const run = async (name: string, input: unknown) => {
    const out = await one.stub.batch({ ent: ENT, who: { kind: 'browser', authUserId: 'auth-usr_001' }, calls: [{ i: 0, name, input }], overviewCalls: 0, worker: 0 }, w.netFor(ENT));
    if (!out.ok) throw new Error(out.error.message);
    return JSON.parse(out.body).results[0] as { ok: boolean; error?: { code: string; details?: { reason?: string } } };
  };
  return { w, one, run };
}
const LIMIT_REFUSAL = { ok: false, error: { code: 'conflict', details: { reason: 'people_limit' } } };

describe('the people limit', () => {
  it('counts active humans, and PEOPLE_COUNT_LITE gives the same number', async () => {
    const { one } = await world(3);
    expect(one.raw.prepare(PEOPLE_COUNT_LITE).get()).toEqual({ n: 3 });
  });

  it('refuses the 4th human with people_limit and creates nobody', async () => {
    const { one, run } = await world(3);
    expect(await run('users.create', NEW(1))).toMatchObject(LIMIT_REFUSAL);
    expect(one.raw.prepare("select count(*) as n from users where id = 'usr_006'").get()).toEqual({ n: 0 });
  });

  it('allows the 3rd human when only the Admin and one Member are active', async () => {
    const { run } = await world(3, (state) => { state.users.usr_003!.active = false; });
    expect((await run('users.create', NEW(1))).ok).toBe(true);
    expect(await run('users.create', NEW(2))).toMatchObject(LIMIT_REFUSAL);
  });

  it('does not count a turned-off person: the create passes after a turn-off', async () => {
    const { run } = await world(3);
    expect(await run('users.create', NEW(1))).toMatchObject(LIMIT_REFUSAL);
    expect((await run('users.deactivate', { id: 'usr_003' })).ok).toBe(true);
    expect((await run('users.create', NEW(1))).ok).toBe(true);
  });

  it('refuses users.reactivate of a human at the limit, and allows it below', async () => {
    const { run } = await world(3);
    expect(await run('users.reactivate', { id: 'usr_004' })).toMatchObject(LIMIT_REFUSAL);
    expect((await run('users.deactivate', { id: 'usr_003' })).ok).toBe(true);
    expect((await run('users.reactivate', { id: 'usr_004' })).ok).toBe(true);
  });

  it('does not count a removed person', async () => {
    const { run } = await world(3, (state) => { state.users.usr_004!.removed = true; });
    expect(await run('users.create', NEW(1))).toMatchObject(LIMIT_REFUSAL);
    expect((await run('users.deactivate', { id: 'usr_003' })).ok).toBe(true);
    expect((await run('users.create', NEW(1))).ok).toBe(true);
  });

  it('counts an invited person (active, no password)', async () => {
    // The three active humans have no sign-in row with a password: they are all invited, and they count.
    const { run } = await world(3);
    expect(await run('users.create', NEW(1))).toMatchObject(LIMIT_REFUSAL);
  });

  it('never counts or refuses an agent', async () => {
    const { run } = await world(3);
    expect((await run('users.create', { name: 'Helper', email: 'helper@acme.test', discipline: 'Agent', kind: 'agent', ownerId: 'usr_003' })).ok).toBe(true);
  });

  it('never refuses with no limit', async () => {
    const { run } = await world(null);
    for (let n = 1; n <= 4; n += 1) expect((await run('users.create', NEW(n))).ok).toBe(true);
  });

  it('never refuses an office with no facts (the Postgres path, ENT_VADO with no limit)', async () => {
    await expect(assertRoomForPerson(async () => [{ n: 99 }] as never, null)).resolves.toBeUndefined();
    await expect(assertRoomForPerson(async () => [{ n: 3 }] as never, 3)).rejects.toMatchObject({ code: 'conflict', details: { reason: 'people_limit' } });
    await expect(assertRoomForPerson(async () => [{ n: 2 }] as never, 3)).resolves.toBeUndefined();
  });
});
