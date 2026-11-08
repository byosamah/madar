import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { addSubCompanies } from '../daftra/testOffice';
import { startLive } from './test/live/harness';

/**
 * Google Calendar and the Daftra link on local workerd (plan A of Madar enterprises). The real office object runs in workerd. Its
 * Google and Daftra requests go through the network port to the Worker, and the Worker sends them to the fakes of the test Worker
 * (test/live/outside.ts). So these tests prove the port over real RPC, with the Worker side adding the Daftra key.
 */

describe('Google and Daftra on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive({ outside: true });
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('connects Google and syncs a meeting through the network port of the Worker', async () => {
    await live.fresh(await buildSeed('2026-10-21', async () => undefined));
    const start = (await live.batch('usr_001', [{ name: 'google.connectStart', input: {} }])).body.results[0] as { ok: boolean; output: { url: string } };
    expect(start.ok).toBe(true);
    const state = new URL(start.output.url).searchParams.get('state');
    const connect = (await live.batch('usr_001', [{ name: 'google.connect', input: { code: 'code-SECRET', state } }])).body.results[0] as { ok: boolean; output?: { state: string }; error?: unknown };
    expect(connect, JSON.stringify(connect)).toMatchObject({ ok: true, output: { state: 'ok' } });
    const made = (await live.batch('usr_001', [{ name: 'meetings.create', input: { kind: 'meeting', title: 'Kickoff', where: 'Room', startsAt: '2030-01-10T10:00:00.000+03:00' } }])).body.results[0];
    expect(made).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      const seen = (await live.outside()).google;
      expect(seen.some((one) => one.method === 'POST' && one.path === '/token')).toBe(true);
      expect(seen.some((one) => one.method === 'POST' && one.path === '/calendar/v3/calendars')).toBe(true);
      expect(seen.some((one) => one.method === 'POST' && /^\/calendar\/v3\/calendars\/[^/]+\/events$/.test(one.path))).toBe(true);
    }, { timeout: 10_000 });
  });

  it('reads Daftra through the Worker on the Cron run, and sets Received', async () => {
    const seed = await buildSeed('2026-10-26', async () => undefined);
    addSubCompanies(seed);
    seed.payments!.pay_003.daftra = {
      account: 'MAZJ', invoiceId: '1830', invoiceNo: 'N1830', total: 5, issuedOn: '2026-10-20', linkedBy: 'usr_011', linkedAt: '2026-10-20T10:00:00.000+03:00',
    };
    await live.fresh(seed);
    const run = await live.worker().scheduled({ cron: '*/15 * * * *', scheduledTime: new Date('2026-10-26T06:00:00Z') });
    expect(run.outcome).toBe('ok');
    await vi.waitFor(async () => expect((await live.readBack()).payments!.pay_003.receivedOn).toBe('2026-10-22'), { timeout: 10_000 });
    expect((await live.outside()).daftra).toContainEqual({ method: 'GET', url: 'https://mazj.daftra.com/api2/invoices/1830.json' });
  });
});
