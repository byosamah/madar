import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import '../usage/effects';
import { meterPort } from '../usage/meter';
import { readMeters, readUsage } from '../usage/meters';
import { LIMIT_WARNING_EFFECT, checkLimits } from '../usage/warn';
import { NOW, newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * Suite 13 of TM 7, the usage meters, on the local stack (plan 5.8; task M1) [Docker]: the meter statement, the meter reads,
 * usage.get through runCall as madar_server, and the 80% warning through the outbox, the mail quota and the fake mail port.
 * server/usage/*.test.ts check the same rules in memory.
 */

const GB = 1024 * 1024 * 1024;
let office: ItOffice;
let deps: ReturnType<ItOffice['isolate']>;

const call = (userId: string) => runCall(deps, { principal: { userId }, name: 'usage.get', input: {}, batch: newBatch() });

function okOf<T>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

beforeAll(async () => {
  office = await startOffice('m1use');
  deps = office.isolate();
}, 60_000);

beforeEach(async () => {
  await office.sql('truncate usage_month, usage_warnings, outbox, mail_log, job_runs');
  deps.mail.sent.length = 0;
  deps.clock.set(NOW);
});

afterAll(async () => {
  await office?.close();
});

describe('suite 13: the usage meters on the local database', () => {
  it('counts each request in the UTC month with the bytes read and the failed signals, in one statement as madar_server', async () => {
    const meter = meterPort();
    meter.addBytes(1500);
    meter.signalsFailed(2);
    await meter.countRequest(deps.db);
    meter.addBytes(500);
    await meter.countRequest(deps.db);
    const [row] = await office.sql<{ month: string; calls: string; bytes_read: string; signals_failed: string; signals_failed_at: Date | null }>('select * from usage_month');
    expect(row.month).toBe(new Date().toISOString().slice(0, 7));
    expect([Number(row.calls), Number(row.bytes_read), Number(row.signals_failed)]).toEqual([2, 2000, 2]);
    expect(row.signals_failed_at).toBeInstanceOf(Date);
  });

  it('reads every meter: calls and egress of the month, the database size, the file versions, the backup copy and the emails', async () => {
    await office.sql("insert into usage_month (month, calls, bytes_read, backup_bytes) values ('2026-10', 1200, 4096, null), ('2026-09', 99, 1, 777)");
    await office.sql("insert into mail_log (utc_day, kind, ref) values ('2026-10-04', 'notice', 'a'), ('2026-10-04', 'signin', 'b'), ('2026-10-02', 'warning', 'c'), ('2026-10-04', 'refused', 'quota-refused'), ('2026-09-30', 'notice', 'd')");
    const fileBytes = Object.values(office.seed.files).flatMap((file) => file.versions).reduce((sum, version) => sum + version.size, 0);
    const meters = await deps.db.tx('read', (q) => readMeters(q, deps.config, NOW));
    expect(meters).toMatchObject({
      month: '2026-10',
      calls: { used: 1200 },
      egress: { used: 4096 },
      backupCopy: { used: 777 },
      files: { used: fileBytes, limit: GB },
      emails: { used: 2, limit: 100 },
      emailsMonth: { used: 3, limit: 3000 },
    });
    expect(fileBytes).toBeGreaterThan(0);
    expect(meters.database.used).toBeGreaterThan(1024 * 1024);
  });

  it('lists the failed effects with no payload, the recent failed signals, and the heartbeat of the job', async () => {
    await office.sql("insert into outbox (kind, payload, attempts, error) values ('auth.invite', '{\"tokenHash\":\"live-hash\"}', 5, 'Auth said no.')");
    await office.sql("insert into outbox (kind, payload, attempts, done_at) values ('mail.notice', '{}', 1, now())");
    await office.sql("insert into outbox (kind, payload, attempts) values ('mail.notice', '{}', 0)");
    await office.sql("insert into usage_month (month, signals_failed, signals_failed_at) values ('2026-10', 3, $1)", [new Date(NOW.getTime() - 60_000)]);
    await office.sql("insert into job_runs (key, done_at) values ('heartbeat', $1)", [new Date(NOW.getTime() - 5 * 60_000)]);
    const usage = await deps.db.tx('read', (q) => readUsage(q, deps.config, NOW));
    expect(usage.failedEffects.map((e) => [e.kind, e.attempts, e.error])).toEqual([['realtime.signal', 3, '3 change signals were not sent this month.'], ['auth.invite', 5, 'Auth said no.']]);
    expect(JSON.stringify(usage)).not.toContain('live-hash');
    expect(usage.jobsLastRun).toBe('2026-10-04T08:55:00.000+03:00');
  });

  it('gives usage.get to the Admin and forbidden to a Member, through runCall', async () => {
    expect(okOf<{ month: string }>(await call('usr_001')).month).toBe('2026-10');
    const refused = await call('usr_002');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('forbidden');
  });

  it('sends one warning to each active Admin at 80%, not one for each run, and again in a new month', async () => {
    await office.sql("insert into usage_month (month, calls) values ('2026-10', 400000), ('2026-11', 410000)");
    const admins = Object.values(office.seed.users).filter((u) => u.kind === 'human' && u.active && u.systemRole === 'admin').map((u) => u.email).sort();
    expect(await checkLimits(deps)).toEqual({ warned: ['calls'] });
    expect(await checkLimits(deps)).toEqual({ warned: [] });
    expect(deps.mail.sent.map((m) => m.to).sort()).toEqual(admins);
    expect(deps.mail.sent[0].text).toContain('Next step: move Madar to the paid database plan before the month ends.');
    const rows = await office.sql<{ kind: string; done: boolean }>('select kind, done_at is not null as done from outbox');
    expect(rows).toEqual(admins.map(() => ({ kind: LIMIT_WARNING_EFFECT, done: true })));
    expect((await office.sql<{ n: string }>("select count(*) as n from mail_log where kind = 'warning'"))[0].n).toBe(String(admins.length));
    deps.clock.set('2026-11-02T06:00:00Z');
    expect(await checkLimits(deps)).toEqual({ warned: ['calls'] });
    expect(deps.mail.sent).toHaveLength(admins.length * 2);
  });

  it('marks a meter once when two runs overlap', async () => {
    await office.sql("insert into usage_month (month, bytes_read) values ('2026-10', $1)", [Math.round(4.5 * GB)]);
    const other = office.isolate();
    other.clock.set(NOW);
    const runs = await Promise.all([checkLimits(deps), checkLimits(other)]);
    expect(runs.flatMap((r) => r.warned)).toEqual(['egress']);
    expect(await office.sql('select month, metric from usage_warnings')).toEqual([{ month: '2026-10', metric: 'egress' }]);
  });
});
