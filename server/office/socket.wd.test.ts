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
type Message = { event: string; payload: Record<string, unknown> };
const messagesOf = (socket: SocketClient): Message[] => socket.got.filter((text) => text !== 'pong').map((text) => JSON.parse(text) as Message);
/** The change signals only: the presence events and the typing events (chat presence design) come on the same socket. */
const signalsOf = (socket: SocketClient): ChangeSignal[] => messagesOf(socket).filter((m) => m.event === 'changed').map((m) => m.payload as unknown as ChangeSignal);
const eventsOf = (socket: SocketClient, event: string): Message['payload'][] => messagesOf(socket).filter((m) => m.event === event).map((m) => m.payload);

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

  it('gives a new socket the states of all, takes the state of a device, and tells the office when a socket closes (chat presence design)', async () => {
    await live.fresh(await seedOf());
    const watcher = await socketOf('usr_002');
    await vi.waitFor(() => expect(eventsOf(watcher, 'presence')[0]).toEqual({ v: 1, states: { usr_002: 'away' } }));
    const phone = await socketOf('usr_003');
    phone.ws.send(JSON.stringify({ t: 'state', state: 'online' }));
    await vi.waitFor(() => expect(eventsOf(watcher, 'presence')).toContainEqual({ v: 1, userId: 'usr_003', state: 'online' }));
    // Rubbish on the socket changes nothing and does not close it.
    phone.ws.send(JSON.stringify({ t: 'state', state: 'busy' }));
    phone.ws.send('{');
    phone.ws.close();
    await vi.waitFor(() => expect(eventsOf(watcher, 'presence')).toContainEqual({ v: 1, userId: 'usr_003', state: 'offline' }));
    watcher.ws.close();
  });

  it('keeps the state of a socket across a hibernation', async () => {
    await live.fresh(await seedOf());
    const online = await socketOf('usr_002');
    online.ws.send(JSON.stringify({ t: 'state', state: 'online' }));
    await vi.waitFor(() => expect(eventsOf(online, 'presence')).toContainEqual({ v: 1, userId: 'usr_002', state: 'online' }));
    const away = await socketOf('usr_003');
    away.ws.send(JSON.stringify({ t: 'state', state: 'away' }));
    // The state message of an Away socket changes nothing: the person was Away already (no state counts as Away).
    await new Promise((resolve) => setTimeout(resolve, 200));
    await live.evict();
    const fresh = await socketOf('usr_005');
    await vi.waitFor(() => expect(eventsOf(fresh, 'presence').length).toBeGreaterThan(0));
    expect(eventsOf(fresh, 'presence')[0]).toEqual({ v: 1, states: { usr_002: 'online', usr_003: 'away', usr_005: 'away' } });
    // The object is awake again and still tells a change.
    away.ws.send(JSON.stringify({ t: 'state', state: 'online' }));
    await vi.waitFor(() => expect(eventsOf(fresh, 'presence')).toContainEqual({ v: 1, userId: 'usr_003', state: 'online' }));
    for (const socket of [online, away, fresh]) socket.ws.close();
  });

  it("a person's typing reaches only the sockets of the named people", async () => {
    await live.fresh(await seedOf());
    // cnv_015 is the group of usr_002, usr_001, usr_005 and usr_003; usr_004 is in no chat of the sample office.
    const [typist, typistPhone, member, other, outsider] = await Promise.all(['usr_005', 'usr_005', 'usr_002', 'usr_003', 'usr_004'].map((id) => socketOf(id)));
    const { body } = await live.batch('usr_005', [{ name: 'chats.typing', input: { conversationId: 'cnv_015', typing: true } }]);
    expect(body.results[0]).toMatchObject({ ok: true, output: { sent: 3 } });
    await vi.waitFor(() => {
      for (const socket of [member, other]) expect(eventsOf(socket, 'typing')).toHaveLength(1);
    });
    expect(eventsOf(member, 'typing')[0]).toMatchObject({ v: 1, conversationId: 'cnv_015', userId: 'usr_005', typing: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const socket of [typist, typistPhone, outsider]) expect(eventsOf(socket, 'typing')).toEqual([]);
    // The outsider gets the answer of a chat that never was, and no signal.
    const hidden = await live.batch('usr_004', [{ name: 'chats.typing', input: { conversationId: 'cnv_015', typing: true } }]);
    expect(hidden.body.results[0]).toMatchObject({ ok: false, error: { code: 'not_found' } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(eventsOf(member, 'typing')).toHaveLength(1);
    for (const socket of [typist, typistPhone, member, other, outsider]) socket.ws.close();
  });

  it('closes the socket of a person whom the Admin turns off', async () => {
    await live.fresh(await seedOf());
    const socket = await socketOf('usr_007');
    await live.batch('usr_001', [{ name: 'users.deactivate', input: { id: 'usr_007' } }]);
    expect((await socket.closed).code).toBe(4003);
  });
});
