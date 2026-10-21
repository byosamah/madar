import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { startLive, type SocketClient } from './test/live/harness';

const DAY = '2026-10-04';
/** 08:00 Riyadh on a Sunday: the reminders of the sample office are due, and so is the morning summary. */
const AT = new Date('2026-10-04T05:00:00Z');
const seedOf = () => buildSeed(DAY, async () => undefined);
const mailOn = (seed: State): State => {
  const prefs = seed.users.usr_002.preferences;
  seed.users.usr_002 = { ...seed.users.usr_002, preferences: { ...prefs, email: { ...prefs.email, due_tomorrow: true, overdue: true } } };
  return seed;
};

describe('the Cron of the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  const cron = (at: Date) => live.worker().scheduled({ cron: '*/15 * * * *', scheduledTime: at });
  const socketOf = async (userId: string): Promise<SocketClient> => {
    const ticket = ((await live.batch(userId, [{ name: 'live.ticket', input: {} }])).body.results[0] as { output: { ticket: string } }).output.ticket;
    const socket = live.open(ticket);
    await socket.opened;
    return socket;
  };
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('runs the job steps, mails through the network port of the Worker, and writes the heartbeat', async () => {
    await live.fresh(mailOn(await seedOf()));
    expect((await cron(AT)).outcome).toBe('ok');
    await vi.waitFor(async () => expect(await live.rows("select done_at from job_runs where key = 'heartbeat'")).toEqual([{ done_at: AT.toISOString() }]), { timeout: 10_000 });
    await vi.waitFor(async () => {
      const keys = (await live.net()).mails.map((m) => m.idempotencyKey);
      expect(keys.some((key) => key.startsWith('notice-'))).toBe(true);
      expect(keys).toContain(`summary-${DAY}-usr_002`);
    }, { timeout: 10_000 });
  });

  it('settles a meeting that ended with the normal call of the object, and makes the Tracker line once (fbk_022, wave 2)', async () => {
    const seed = await seedOf();
    seed.meetings = {
      mtg_001: {
        id: 'mtg_001', kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-10-04T06:00:00.000+03:00', endsAt: '2026-10-04T07:00:00.000+03:00',
        where: '', guests: '', notes: '', organizerId: 'usr_002', attendeeIds: ['usr_003'], status: 'scheduled', rev: 1, createdBy: 'usr_002', createdAt: '2026-10-03T09:00:00.000+03:00',
      },
    };
    await live.fresh(seed);
    expect((await cron(AT)).outcome).toBe('ok');
    const lines = () => live.rows<{ id: string }>("select id from tracker where json_extract(doc, '$.auto') = 'meeting'");
    // The call runs on the clock of the Worker, so the mark holds the real time of the run, not the time that the Cron names.
    await vi.waitFor(async () => expect(await live.rows<{ done: number }>("select settled_at is not null as done from meetings where id = 'mtg_001'")).toEqual([{ done: 1 }]), { timeout: 10_000 });
    expect(await lines()).toHaveLength(1);
    expect(await live.rows("select json_extract(doc, '$.date') as day from tracker where json_extract(doc, '$.auto') = 'meeting'")).toEqual([{ day: '2026-10-04' }]);
    // The next run finds the mark and writes no second line.
    expect((await cron(new Date(AT.getTime() + 15 * 60_000))).outcome).toBe('ok');
    expect(await lines()).toHaveLength(1);
  });

  it('sends at most 45 network calls in one run, and the next run sends the rest with no attempt lost', async () => {
    const seed = await seedOf();
    seed.notifications.ntf_901 = { id: 'ntf_901', userId: 'usr_002', trigger: 'task_assigned', actorId: 'usr_001', targetType: 'task', targetId: 'tsk_001', read: false, createdAt: '2026-10-04T04:00:00.000+03:00', dedupeKey: null };
    await live.fresh(seed);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    for (let i = 0; i < 50; i += 1) await live.exec("insert into outbox (kind, payload, created_at) values ('mail.notice', ?1, ?2)", [JSON.stringify({ notificationId: 'ntf_901' }), old]);
    // 02:00 UTC is 05:00 Riyadh: before the morning summary, so only the outbox step mails.
    await cron(new Date('2026-10-04T02:00:00Z'));
    await vi.waitFor(async () => expect((await live.rows<{ n: number }>("select count(*) as n from outbox where done_at is null and error is not null"))[0].n).toBe(5), { timeout: 10_000 });
    expect((await live.net()).mails).toHaveLength(45);
    // The rows that the budget stopped wait one minute; the test moves that minute past.
    await live.exec('update outbox set claimed_until = null where done_at is null');
    await cron(new Date('2026-10-04T02:15:00Z'));
    await vi.waitFor(async () => expect(await live.rows("select count(*) as n from outbox where kind = 'mail.notice' and done_at is null")).toEqual([{ n: 0 }]), { timeout: 10_000 });
    expect((await live.net()).mails).toHaveLength(50);
    expect(await live.rows('select max(attempts) as n from outbox')).toEqual([{ n: 1 }]);
  });

  it('closes a socket with no pong in a Cron run, and keeps one that pinged', async () => {
    await live.fresh(await seedOf());
    const quiet = await socketOf('usr_002');
    const pinged = await socketOf('usr_003');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    pinged.ws.send('ping');
    await vi.waitFor(() => expect(pinged.got).toContain('pong'));
    // MADAR_LIVE_STALE_MS is 1,500 in the test Worker: quiet is about 1.8 s old, pinged answered about 0.8 s ago.
    await new Promise((resolve) => setTimeout(resolve, 800));
    await cron(new Date('2026-10-04T02:30:00Z'));
    expect((await quiet.closed).code).toBe(4000);
    expect(pinged.ws.readyState).toBe(WebSocket.OPEN);
    pinged.ws.close();
  });

  // The 80% warning of the day meters went with the usage feature (b62c3787, owner batch of 2026-10-20), so its test went too.
});
