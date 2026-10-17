import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { ChangeSignal } from '../core/types';
import { everyCall } from '../core/everyCall';
import { startLive, type SocketClient } from './test/live/harness';

const TODAY = new Date().toISOString().slice(0, 10);
const seedOf = () => buildSeed(TODAY, async () => undefined);
/**
 * A write that changes the sample office: a new title for a task of prj_001. The tasks.move entry of everyCall moves its task to
 * in_progress, and the seed task is in_progress already, so on a fresh seed that move changes nothing and sends no signal.
 */
const writeOf = (seed: State) => everyCall(seed).find((c) => c.name === 'tasks.update')!;
const signalsOf = (socket: SocketClient): ChangeSignal[] =>
  socket.got.filter((text) => text !== 'pong').map((text) => (JSON.parse(text) as { payload: ChangeSignal }).payload);

describe('the live sockets of the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  const ticketOf = async (userId: string) => ((await live.batch(userId, [{ name: 'live.ticket', input: {} }])).body.results[0] as { output: { ticket: string } }).output.ticket;
  const socketOf = async (userId: string) => {
    const socket = live.open(await ticketOf(userId));
    await socket.opened;
    return socket;
  };
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('sends the change of a write to an open socket after the commit', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const socket = await socketOf('usr_002');
    const write = writeOf(seed);
    await live.batch(write.actorId, [{ name: write.name, input: write.input }]);
    await vi.waitFor(() => expect(signalsOf(socket).map((s) => s.channel)).toContain('office'));
    socket.ws.close();
  });

  it('never sends an office task change to an outsider socket', async () => {
    await live.fresh(await seedOf());
    const [maker, lead, admin, outsider] = await Promise.all(['usr_002', 'usr_003', 'usr_001', 'usr_008'].map((id) => socketOf(id)));
    const { body } = await live.batch('usr_002', [{ name: 'tasks.create', input: { title: 'Office errand', ownerId: 'usr_003', description: '', flagged: false } }]);
    expect(body.results[0].ok).toBe(true);
    await vi.waitFor(() => {
      for (const socket of [maker, lead, admin]) expect(signalsOf(socket).some((s) => s.channel.startsWith('person:'))).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(signalsOf(outsider)).toEqual([]);
    for (const socket of [maker, lead, admin]) for (const s of signalsOf(socket)) expect(s).not.toHaveProperty('actorId');
    for (const socket of [maker, lead, admin, outsider]) socket.ws.close();
  });

  it('a person signal never reaches the socket of another person', async () => {
    await live.fresh(await seedOf());
    const [mine, other] = await Promise.all([socketOf('usr_003'), socketOf('usr_002')]);
    await live.batch('usr_001', [{ name: 'tasks.create', input: { projectId: 'prj_001', title: 'Site photos', ownerId: 'usr_003', description: '', flagged: false } }]);
    await vi.waitFor(() => expect(signalsOf(mine).map((s) => s.channel)).toContain('person:usr_003'));
    expect(signalsOf(other).map((s) => s.channel).filter((channel) => channel !== 'office' && channel !== 'person:usr_002')).toEqual([]);
    mine.ws.close();
    other.ws.close();
  });

  it('opens one socket for a ticket, and none for a used or a forged ticket', async () => {
    await live.fresh(await seedOf());
    const ticket = await ticketOf('usr_005');
    const first = live.open(ticket);
    await first.opened;
    await expect(live.open(ticket).opened).rejects.toThrow('did not open');
    await expect(live.open('f'.repeat(64)).opened).rejects.toThrow('did not open');
    first.ws.close();
  });

  it('answers a ping with a pong, and keeps the socket open across a hibernation', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const socket = await socketOf('usr_002');
    socket.ws.send('ping');
    await vi.waitFor(() => expect(socket.got).toContain('pong'));
    await live.evict();
    const write = writeOf(seed);
    await live.batch(write.actorId, [{ name: write.name, input: write.input }]);
    await vi.waitFor(() => expect(signalsOf(socket).length).toBeGreaterThan(0));
    socket.ws.close();
  });

  it('closes the socket of a person whom the Admin turns off', async () => {
    await live.fresh(await seedOf());
    const socket = await socketOf('usr_007');
    await live.batch('usr_001', [{ name: 'users.deactivate', input: { id: 'usr_007' } }]);
    expect((await socket.closed).code).toBe(4003);
  });
});
