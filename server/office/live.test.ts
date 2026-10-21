import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { ChangeSignal } from '../core/types';
import { readLiteOffice } from '../data/lite/office';
import { liteSave } from '../data/lite/save';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { CLOSE_OFF, CLOSE_STALE, LIVE_STALE_MS, LiveTickets, TICKET_CAP, TICKET_MS, acceptLive, closeOff, liveSignals, sweep } from './live';
import { PRESENCE_EVENT, officeStates, officeTyping, socketClosed, stateMessage } from './presence';
import { fakeSockets, openFor, type FakeSocket } from './test/fakes';

const NOW = new Date('2026-10-04T06:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const signal = (channel: ChangeSignal['channel'], people: string[] = []): ChangeSignal => ({ v: 1, id: 'sig_1', channel, seq: 1, projects: [], office: false, kinds: ['tasks'], people });
const received = (socket: { sent: string[] }) => socket.sent.map((text) => JSON.parse(text) as { event: string; payload: ChangeSignal });
const upgrade = (ticket: string, extra = '') => new Request(`https://office.internal/live?ticket=${ticket}${extra}`, { headers: { upgrade: 'websocket' } });

async function liveOffice() {
  const lite = await freshLite();
  const seed = await buildSeed('2026-10-04', async () => undefined);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const sockets = fakeSockets();
  const port = liveSignals({ sockets, log: silent, now: () => NOW, staleMs: LIVE_STALE_MS });
  const tickets = new LiveTickets();
  const accept = (request: Request, at = NOW) => acceptLive({ sockets, tickets, office: () => lite.db.tx('read', (q) => readLiteOffice(lite.db, q)), now: () => at }, request);
  return { ...lite, seed, sockets, port, tickets, accept };
}

describe('the change signals on the sockets of the office object (server/office/live.ts)', () => {
  it('sends each signal after the commit, on the sockets of its channel only', async () => {
    const { db, sockets, port } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    await db.tx('write', async (q) => {
      await port.send(q, [signal('office'), signal('person:usr_002', ['usr_002'])]);
      expect(a.sent).toEqual([]);
    });
    expect(received(a).map((m) => [m.event, m.payload.channel])).toEqual([['changed', 'office'], ['changed', 'person:usr_002']]);
    expect(received(b).map((m) => m.payload.channel)).toEqual(['office']);
  });

  it('sends nothing when the transaction rolls back', async () => {
    const { db, sockets, port } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    await expect(db.tx('write', async (q) => {
      await port.send(q, [signal('office')]);
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(a.sent).toEqual([]);
  });

  it('an office task change reaches its people and the Admins, never an outsider socket', async () => {
    const { db, seed, sockets, port } = await liveOffice();
    const at = NOW.getTime();
    const maker = openFor(sockets, 'usr_002', at);
    const lead = openFor(sockets, 'usr_003', at);
    const admin = openFor(sockets, 'usr_001', at);
    const outsider = openFor(sockets, 'usr_008', at);
    const after = structuredClone(seed);
    const base = Object.values(seed.tasks)[0];
    after.tasks.tsk_901 = { ...base, id: 'tsk_901', projectId: null, stageId: null, createdBy: 'usr_002', ownerId: 'usr_003', helperIds: [], prerequisiteIds: [], title: 'Office errand' };
    await db.tx('write', async (q) => {
      const saved = await liteSave(q, seed, after, { story: { storyId: 'sty_test', actorId: 'usr_002' } });
      await port.send(q, saved.signals);
    });
    expect(outsider.sent).toEqual([]);
    for (const socket of [maker, lead, admin]) expect(received(socket)).toHaveLength(1);
    for (const socket of [maker, lead, admin]) {
      const { payload } = received(socket)[0];
      expect(payload.channel.startsWith('person:')).toBe(true);
      expect(payload).not.toHaveProperty('actorId');
      expect(payload).not.toHaveProperty('storyId');
    }
  });

  it('a person signal never reaches the socket of another person', async () => {
    const { db, sockets, port } = await liveOffice();
    const mine = openFor(sockets, 'usr_002', NOW.getTime());
    const other = openFor(sockets, 'usr_003', NOW.getTime());
    await db.tx('write', (q) => port.send(q, [signal('person:usr_002', ['usr_002'])]));
    expect(received(mine)).toHaveLength(1);
    expect(other.sent).toEqual([]);
  });

  it('does not fail the transaction when a send throws: the screen reloads when its socket opens again', async () => {
    const { db, sockets, port } = await liveOffice();
    openFor(sockets, 'usr_002', NOW.getTime()).failSend = true;
    await expect(db.tx('write', (q) => port.send(q, [signal('office')]))).resolves.toBeUndefined();
  });
});

describe('the live tickets', () => {
  it('opens one socket for its own person only, once, and only for 60 seconds', async () => {
    const { tickets, accept, sockets } = await liveOffice();
    const { ticket, expiresAt } = tickets.mint('usr_005', NOW);
    expect(expiresAt).toBe('2026-10-04T09:01:00.000+03:00');
    const answer = await accept(upgrade(ticket, '&who=usr_002'));
    expect(answer.status).toBe(101);
    expect(sockets.all.map((one) => one.tags)).toEqual([['office', 'person:usr_005']]);
    expect((await accept(upgrade(ticket))).status).toBe(401);
    const old = tickets.mint('usr_005', NOW).ticket;
    expect((await accept(upgrade(old), later(TICKET_MS + 1))).status).toBe(401);
  });

  it('refuses a forged, a used and an old ticket with the same answer, which names no person', async () => {
    const { tickets, accept } = await liveOffice();
    const used = tickets.mint('usr_005', NOW).ticket;
    await accept(upgrade(used));
    const old = tickets.mint('usr_005', NOW).ticket;
    const bodies = await Promise.all([
      accept(upgrade('f'.repeat(64))).then((r) => r.text()),
      accept(upgrade(used)).then((r) => r.text()),
      accept(upgrade(old), later(TICKET_MS + 1)).then((r) => r.text()),
    ]);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain('usr_');
  });

  it('refuses the ticket of a person who was turned off after the ticket', async () => {
    const { db, seed, tickets, accept } = await liveOffice();
    const { ticket } = tickets.mint('usr_004', NOW);
    const after = structuredClone(seed);
    after.users.usr_004 = { ...after.users.usr_004, active: false };
    await db.tx('write', (q) => liteSave(q, seed, after));
    const answer = await accept(upgrade(ticket));
    expect(answer.status).toBe(403);
    expect(((await answer.json()) as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('account_off');
  });

  it('refuses a request with no upgrade, and keeps its ticket', async () => {
    const { tickets, accept } = await liveOffice();
    const { ticket } = tickets.mint('usr_005', NOW);
    expect((await accept(new Request(`https://office.internal/live?ticket=${ticket}`))).status).toBe(426);
    expect((await accept(upgrade(ticket))).status).toBe(101);
  });

  it(`keeps at most ${TICKET_CAP} tickets, and drops the oldest first`, async () => {
    const { tickets, accept } = await liveOffice();
    const first = tickets.mint('usr_005', NOW).ticket;
    for (let i = 0; i < TICKET_CAP; i += 1) tickets.mint('usr_005', NOW);
    expect((await accept(upgrade(first))).status).toBe(401);
  });
});

describe('the sweep and the turned-off people', () => {
  it('closes a socket with no pong for 150 s, and keeps one that pinged', async () => {
    const { sockets } = await liveOffice();
    const quiet = openFor(sockets, 'usr_002', NOW.getTime());
    const pinged = openFor(sockets, 'usr_003', NOW.getTime());
    sockets.pongs.set(pinged, later(LIVE_STALE_MS));
    expect(sweep(sockets, later(LIVE_STALE_MS + 1_000), LIVE_STALE_MS)).toBe(1);
    expect(quiet.closed?.code).toBe(CLOSE_STALE);
    expect(pinged.closed).toBeUndefined();
  });

  it('closes the sockets of a person who is off, and keeps the others', async () => {
    const { db, seed, sockets } = await liveOffice();
    const off = openFor(sockets, 'usr_007', NOW.getTime());
    const on = openFor(sockets, 'usr_002', NOW.getTime());
    const after = structuredClone(seed);
    after.users.usr_007 = { ...after.users.usr_007, active: false };
    await db.tx('write', (q) => liteSave(q, seed, after));
    expect(closeOff(sockets, await db.tx('read', (q) => readLiteOffice(db, q)))).toBe(1);
    expect(off.closed?.code).toBe(CLOSE_OFF);
    expect(on.closed).toBeUndefined();
  });
});

type Presence = { event: string; payload: { v: 1; userId?: string; state?: string; states?: Record<string, string> } };
/** The presence events a fake socket got, in order. */
const presenceOf = (socket: FakeSocket): Presence[] => socket.sent.map((text) => JSON.parse(text) as Presence).filter((m) => m.event === PRESENCE_EVENT);
const stateText = (state: string) => JSON.stringify({ t: 'state', state });

describe('the status of people on the sockets of the office object (chat presence design, L3)', () => {
  it('stores the state of a socket and tells the office', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    expect(stateMessage(sockets, b, stateText('online'))).toBe(true);
    expect((b.deserializeAttachment() as { state?: string }).state).toBe('online');
    // A socket with no state counts as away, so Online is a change for the office.
    expect(presenceOf(a)).toEqual([{ event: 'presence', payload: { v: 1, userId: 'usr_003', state: 'online' } }]);
    expect(presenceOf(b)).toHaveLength(1);
    expect(officeStates(sockets)).toEqual({ usr_002: 'away', usr_003: 'online' });
  });

  it('keeps the userId and the open time in the note when it stores a state', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    stateMessage(sockets, a, stateText('away'));
    expect(a.deserializeAttachment()).toMatchObject({ userId: 'usr_002', openedAt: NOW.getTime(), state: 'away' });
  });

  it('tells nothing when a state message leaves the state of the person as it was', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    stateMessage(sockets, b, stateText('away'));
    stateMessage(sockets, b, stateText('away'));
    expect(presenceOf(a)).toEqual([]);
  });

  it('a closed socket makes its person offline for the office', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    stateMessage(sockets, b, stateText('online'));
    a.sent.length = 0;
    // The runtime has taken the socket out of the list already when the close handler runs.
    b.close(1000, 'Closed.');
    socketClosed(sockets, b);
    expect(presenceOf(a)).toEqual([{ event: 'presence', payload: { v: 1, userId: 'usr_003', state: 'offline' } }]);
    expect(officeStates(sockets)).toEqual({ usr_002: 'away' });
  });

  it('tells the office also when the runtime still lists the closing socket', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    stateMessage(sockets, b, stateText('online'));
    a.sent.length = 0;
    // The socket stays in the list (it has not closed yet): its note says it is closing.
    socketClosed(sockets, b);
    expect(b.closed).toBeUndefined();
    expect(presenceOf(a).map((m) => m.payload.state)).toEqual(['offline']);
    expect(officeStates(sockets)).toEqual({ usr_002: 'away' });
  });

  it('joins two devices of one person: Online wins, then Away, then Offline, and tells only a change', async () => {
    const { sockets } = await liveOffice();
    const watcher = openFor(sockets, 'usr_002', NOW.getTime());
    const phone = openFor(sockets, 'usr_003', NOW.getTime());
    const desk = openFor(sockets, 'usr_003', NOW.getTime());
    stateMessage(sockets, phone, stateText('away'));
    stateMessage(sockets, desk, stateText('online'));
    expect(officeStates(sockets).usr_003).toBe('online');
    // The phone goes Online: the person was Online already.
    stateMessage(sockets, phone, stateText('online'));
    stateMessage(sockets, desk, stateText('away'));
    expect(officeStates(sockets).usr_003).toBe('online');
    stateMessage(sockets, phone, stateText('away'));
    expect(officeStates(sockets).usr_003).toBe('away');
    socketClosed(sockets, phone);
    expect(officeStates(sockets).usr_003).toBe('away');
    socketClosed(sockets, desk);
    expect(officeStates(sockets).usr_003).toBeUndefined();
    expect(presenceOf(watcher).map((m) => m.payload.state)).toEqual(['online', 'away', 'offline']);
  });

  it('tells the office when the sweep closes the last socket of a person, and when the account is turned off', async () => {
    const { db, seed, sockets } = await liveOffice();
    const watcher = openFor(sockets, 'usr_002', NOW.getTime() + LIVE_STALE_MS);
    const quiet = openFor(sockets, 'usr_003', NOW.getTime());
    const off = openFor(sockets, 'usr_007', NOW.getTime() + LIVE_STALE_MS);
    sockets.pongs.set(watcher, later(LIVE_STALE_MS));
    sockets.pongs.set(off, later(LIVE_STALE_MS));
    stateMessage(sockets, quiet, stateText('online'));
    watcher.sent.length = 0;
    expect(sweep(sockets, later(LIVE_STALE_MS + 1_000), LIVE_STALE_MS)).toBe(1);
    expect(quiet.closed?.code).toBe(CLOSE_STALE);
    expect(presenceOf(watcher)).toEqual([{ event: 'presence', payload: { v: 1, userId: 'usr_003', state: 'offline' } }]);
    watcher.sent.length = 0;
    const after = structuredClone(seed);
    after.users.usr_007 = { ...after.users.usr_007, active: false };
    await db.tx('write', (q) => liteSave(q, seed, after));
    closeOff(sockets, await db.tx('read', (q) => readLiteOffice(db, q)));
    expect(off.closed?.code).toBe(CLOSE_OFF);
    expect(presenceOf(watcher)).toEqual([{ event: 'presence', payload: { v: 1, userId: 'usr_007', state: 'offline' } }]);
  });

  it('gives a new socket the states of all, and tells the others about its person', async () => {
    const { sockets, tickets, accept } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    stateMessage(sockets, a, stateText('online'));
    stateMessage(sockets, b, stateText('away'));
    a.sent.length = 0;
    b.sent.length = 0;
    const { ticket } = tickets.mint('usr_005', NOW);
    expect((await accept(upgrade(ticket))).status).toBe(101);
    const fresh = sockets.all.at(-1)!.socket;
    expect(presenceOf(fresh)).toEqual([{ event: 'presence', payload: { v: 1, states: { usr_002: 'online', usr_003: 'away', usr_005: 'away' } } }]);
    // The others hear that usr_005 is here (a socket with no state yet counts as away), and the new socket hears it only in its snapshot.
    expect(presenceOf(a)).toEqual([{ event: 'presence', payload: { v: 1, userId: 'usr_005', state: 'away' } }]);
    expect(presenceOf(b)).toHaveLength(1);
  });

  it('ignores a message that is not a state', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    const bad: (string | ArrayBuffer)[] = [
      'ping', 'hello', '', '{', 'null', '[]', '1', JSON.stringify({ t: 'state' }), JSON.stringify({ t: 'state', state: 'busy' }),
      JSON.stringify({ t: 'state', state: 'offline' }), JSON.stringify({ t: 'state', state: ['online'] }), JSON.stringify({ t: 'typing', state: 'online' }),
      JSON.stringify({ t: 'state', state: 'online', userId: 'usr_002' }).replace('"state"', '"stat"'), new ArrayBuffer(8),
      JSON.stringify({ t: 'state', state: 'online', pad: 'x'.repeat(500) }),
    ];
    for (const message of bad) expect(stateMessage(sockets, b, message)).toBe(false);
    expect(presenceOf(a)).toEqual([]);
    expect(b.deserializeAttachment()).not.toHaveProperty('state');
  });

  it('never lets one socket set the state of another person: the person is the one of its ticket', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    stateMessage(sockets, b, JSON.stringify({ t: 'state', state: 'online', userId: 'usr_002' }));
    expect(officeStates(sockets)).toEqual({ usr_002: 'away', usr_003: 'online' });
    expect(a.deserializeAttachment()).not.toHaveProperty('state');
  });

  it('counts a socket with a broken note for nobody', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    a.serializeAttachment({ userId: 7 });
    openFor(sockets, 'usr_003', NOW.getTime()).serializeAttachment({ userId: 'usr_003', openedAt: NOW.getTime(), state: 'busy' });
    expect(officeStates(sockets)).toEqual({ usr_003: 'away' });
  });
});

describe('the typing signal on the sockets of the office object (chat presence design, L3)', () => {
  it('sends the typing event to the sockets of the named people only', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    const a2 = openFor(sockets, 'usr_002', NOW.getTime());
    const b = openFor(sockets, 'usr_003', NOW.getTime());
    const outsider = openFor(sockets, 'usr_008', NOW.getTime());
    const signal = { v: 1 as const, conversationId: 'cnv_1', userId: 'usr_005', typing: true, at: '2026-10-21T08:00:00.000Z' };
    await officeTyping({ sockets }).send(['usr_002', 'usr_003'], signal);
    const typed = (socket: FakeSocket) => socket.sent.map((text) => JSON.parse(text) as { event: string; payload: unknown }).filter((m) => m.event === 'typing');
    expect(typed(a)).toEqual([{ event: 'typing', payload: signal }]);
    expect(typed(a2)).toEqual([{ event: 'typing', payload: signal }]);
    expect(typed(b)).toEqual([{ event: 'typing', payload: signal }]);
    expect(outsider.sent).toEqual([]);
  });

  it('sends nothing for no people, and never throws when a send fails', async () => {
    const { sockets } = await liveOffice();
    const a = openFor(sockets, 'usr_002', NOW.getTime());
    a.failSend = true;
    const signal = { v: 1 as const, conversationId: 'cnv_1', userId: 'usr_005', typing: false, at: '2026-10-21T08:00:00.000Z' };
    await expect(officeTyping({ sockets }).send([], signal)).resolves.toBeUndefined();
    await expect(officeTyping({ sockets }).send(['usr_002'], signal)).resolves.toBeUndefined();
    expect(a.sent).toEqual([]);
  });
});
