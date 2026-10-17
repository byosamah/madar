import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { LiveTickets } from '../office/live';
import { fakeDeps } from '../test/fakes/deps';
import { liveTicket } from './live';

const NOW = new Date('2026-10-04T06:00:00Z');

async function ctxOf(userId: string, o: { live?: boolean; agent?: boolean; off?: boolean } = {}): Promise<{ tickets: LiveTickets; ctx: ServerCallCtx }> {
  const seed = await buildSeed('2026-10-04', async () => undefined);
  if (o.off) seed.users[userId] = { ...seed.users[userId], active: false };
  const deps = fakeDeps();
  const tickets = new LiveTickets();
  if (o.live !== false) deps.live = tickets;
  const principal = o.agent ? { userId, agent: { clientId: 'cli_test' } } : { userId };
  return { tickets, ctx: { deps, principal, office: snapshotOf(seed, 1), batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW } };
}

describe('live.ticket (server/calls/live.ts)', () => {
  it('gives a person a ticket of 60 seconds that the office object takes once', async () => {
    const { tickets, ctx } = await ctxOf('usr_005');
    const { output, changed } = await liveTicket({}, ctx);
    expect([output.ticket, output.expiresAt, changed]).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/), '2026-10-04T09:01:00.000+03:00', false]);
    expect(tickets.take(output.ticket, NOW)).toEqual({ userId: 'usr_005' });
    expect(tickets.take(output.ticket, NOW)).toBeUndefined();
  });

  it('refuses an agent: an agent opens no socket', async () => {
    const { ctx } = await ctxOf('usr_009', { agent: true });
    await expect(liveTicket({}, ctx)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a person who is off', async () => {
    const { ctx } = await ctxOf('usr_004', { off: true });
    await expect(liveTicket({}, ctx)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('answers not_found outside the office object', async () => {
    const { ctx } = await ctxOf('usr_005', { live: false });
    await expect(liveTicket({}, ctx)).rejects.toMatchObject({ code: 'not_found' });
  });
});
