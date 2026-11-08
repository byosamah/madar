import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { everyCall } from '../core/everyCall';
import type { ChangeSignal } from '../core/types';
import { startLive, type SocketClient } from './test/live/harness';

/**
 * The leak tests of two enterprises on local workerd (Madar enterprises, plan B Task 16): two real objects with the same record ids, one
 * Worker, one platform object. The sockets, the tickets and an object that was never made.
 */
const TODAY = new Date().toISOString().slice(0, 10);
const SECOND = 'ent_002';
const seedOf = () => buildSeed(TODAY, async () => undefined);
const writeOf = (seed: State) => everyCall(seed).find((c) => c.name === 'tasks.update')!;
const messagesOf = (socket: SocketClient) => socket.got.filter((text) => text !== 'pong').map((text) => JSON.parse(text) as { event: string; payload: Record<string, unknown> });
const signalsOf = (socket: SocketClient): ChangeSignal[] => messagesOf(socket).filter((m) => m.event === 'changed').map((m) => m.payload as unknown as ChangeSignal);

describe('two enterprises on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  const ticketOf = async (userId: string, ent?: string) =>
    ((await live.batch(userId, [{ name: 'live.ticket', input: {} }], ent ? { ent } : {})).body.results[0] as { output: { ticket: string } }).output.ticket;
  const setup = async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    await live.seedEnterprise(SECOND, await seedOf(), 'globex');
    return seed;
  };
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('a socket of ent_001 gets no signal of a write in ent_002', async () => {
    const seed = await setup();
    const socket = live.open(await ticketOf('usr_002'));
    await socket.opened;
    const write = writeOf(seed);
    // The write goes to ent_002 (the same ids), and then to ent_001 as a control: only the control reaches the socket.
    expect((await live.batch(write.actorId, [{ name: write.name, input: write.input }], { ent: SECOND })).body.results[0].ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(signalsOf(socket)).toEqual([]);
    expect((await live.batch(write.actorId, [{ name: write.name, input: write.input }])).body.results[0].ok).toBe(true);
    await vi.waitFor(() => expect(signalsOf(socket).length).toBeGreaterThan(0));
    socket.ws.close();
  });

  it('the tagged ticket of ent_001 does not open a socket on ent_002', async () => {
    await setup();
    const ticket = await ticketOf('usr_002');
    expect(ticket).toMatch(/^ent_001\./);
    await expect(live.open(ticket.replace('ent_001.', `${SECOND}.`)).opened).rejects.toThrow();
    // The ticket of ent_002 does not open a socket on ent_001 either, and each ticket still opens its own.
    const other = await ticketOf('usr_002', SECOND);
    expect(other).toMatch(/^ent_002\./);
    await expect(live.open(other.replace('ent_002.', 'ent_001.')).opened).rejects.toThrow();
    const own = live.open(ticket);
    await own.opened;
    const second = live.open(other);
    await second.opened;
    own.ws.close();
    second.ws.close();
  });

  it('an object that was never made answers not_found on a batch and makes no row', async () => {
    await setup();
    const never = await live.batch('usr_001', [{ name: 'session.get', input: {} }], { ent: 'ent_009' });
    expect(never.status).toBe(404);
    expect(never.body.error).toMatchObject({ code: 'not_found' });
    expect(await live.rows('select count(*) as n from enterprise', [], { ent: 'ent_009' })).toEqual([{ n: 0 }]);
    // The same two enterprises still answer.
    expect((await live.batch('usr_001', [{ name: 'session.get', input: {} }])).status).toBe(200);
    expect((await live.batch('usr_001', [{ name: 'session.get', input: {} }], { ent: SECOND })).status).toBe(200);
  });
});
