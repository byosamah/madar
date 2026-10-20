import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { ChangeSignal } from '../core/types';
import { readLiteOffice } from '../data/lite/office';
import { liteSave } from '../data/lite/save';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { CLOSE_OFF, CLOSE_STALE, LIVE_STALE_MS, LiveTickets, TICKET_CAP, TICKET_MS, acceptLive, closeOff, liveSignals, sweep } from './live';
import { fakeSockets, openFor } from './test/fakes';

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
