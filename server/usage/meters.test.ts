import { describe, expect, it } from 'vitest';
import { serverContracts } from '../../src/api/contract/server';
import type { Query } from '../core/ports';
import { SENT_TODAY_SQL } from '../mail/quota';
import { testConfig } from '../test/fakes/deps';
import { FAILED_EFFECTS_SQL, JOBS_LAST_RUN_SQL, METERS_SQL, SIGNALS_SQL, overLimit, readMeters, readUsage, warningMeters } from './meters';

/**
 * The usage meters (plan 5.8; task M1). A small answer table in memory gives the rows of each exported statement, so these tests
 * check the shape and the rules; server/it/usage.it.test.ts runs the same statements on the local database.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const GB = 1024 * 1024 * 1024;

type Answers = Partial<Record<'meters' | 'today' | 'failed' | 'signals' | 'jobs', Record<string, unknown>[]>>;

function answering(answers: Answers): Query & { asked: { text: string; values: unknown[] }[] } {
  const asked: { text: string; values: unknown[] }[] = [];
  const q = (async (text: string, values: unknown[] = []) => {
    asked.push({ text, values });
    if (text === METERS_SQL) return answers.meters ?? [{ calls: '0', bytes_read: '0', backup_bytes: null, database_bytes: '0', files_bytes: '0', emails_month: '0' }];
    if (text === SENT_TODAY_SQL) return answers.today ?? [{ n: 0 }];
    if (text === FAILED_EFFECTS_SQL) return answers.failed ?? [];
    if (text === SIGNALS_SQL) return answers.signals ?? [];
    if (text === JOBS_LAST_RUN_SQL) return answers.jobs ?? [];
    throw new Error(`Not a usage statement: ${text.slice(0, 60)}`);
  }) as Query & { asked: typeof asked };
  q.asked = asked;
  return q;
}

describe('readMeters', () => {
  it('reads every meter of the UTC month with its free plan limit, and files against 1 GB while the files stay on Supabase Storage', async () => {
    const q = answering({
      meters: [{ calls: '1200', bytes_read: String(2 * GB), backup_bytes: '3000', database_bytes: '52428800', files_bytes: String(GB / 2), emails_month: '140' }],
      today: [{ n: 12 }],
    });
    const meters = await readMeters(q, testConfig(), NOW);
    expect(meters).toEqual({
      month: '2026-10',
      calls: { used: 1200, limit: 500_000 },
      database: { used: 52428800, limit: 500 * 1024 * 1024 },
      files: { used: GB / 2, limit: GB },
      backupCopy: { used: 3000, limit: 10 * GB },
      emails: { used: 12, limit: 100 },
      emailsMonth: { used: 140, limit: 3000 },
      egress: { used: 2 * GB, limit: 5 * GB },
    });
    expect(q.asked.find((a) => a.text === METERS_SQL)?.values).toEqual(['2026-10', '2026-10-01']);
  });

  it('counts the emails of today with the quota statement of N2 (sentToday), on the UTC day', async () => {
    const q = answering({ today: [{ n: 7 }] });
    await readMeters(q, testConfig(), new Date('2026-10-04T23:30:00Z'));
    expect(q.asked.find((a) => a.text === SENT_TODAY_SQL)?.values).toEqual(['2026-10-04']);
  });

  it('uses the limit of the active store: 10 GB on R2', async () => {
    const meters = await readMeters(answering({}), testConfig({ fileStore: 'r2', limits: { maxFileBytes: 250 * 1024 * 1024, filesTotalBytes: 10 * GB } }), NOW);
    expect(meters.files.limit).toBe(10 * GB);
  });

  it('reads a missing backup size as zero', async () => {
    const meters = await readMeters(answering({}), testConfig(), NOW);
    expect(meters.backupCopy.used).toBe(0);
  });
});

describe('readUsage', () => {
  it('returns the failed effects with their kind, attempts and error, never their payload, as the contract checks', async () => {
    const q = answering({
      failed: [{ id: '17', kind: 'auth.invite', error: 'Auth said no.', attempts: 5, created_at: new Date('2026-10-04T05:00:00Z'), payload: { tokenHash: 'live-token' } }],
    });
    const usage = await readUsage(q, testConfig(), NOW);
    expect(usage.failedEffects).toEqual([{ id: '17', kind: 'auth.invite', error: 'Auth said no.', attempts: 5, createdAt: '2026-10-04T08:00:00.000+03:00' }]);
    expect(JSON.stringify(usage)).not.toContain('live-token');
    expect(FAILED_EFFECTS_SQL).not.toMatch(/payload|\*/);
    expect(() => serverContracts['usage.get'].output.parse(usage)).not.toThrow();
  });

  it('shows the change signals that were not sent in the last day as one failed effect with no id', async () => {
    const q = answering({ signals: [{ signals_failed: '3', signals_failed_at: new Date('2026-10-04T04:00:00Z') }] });
    const usage = await readUsage(q, testConfig(), NOW);
    expect(usage.failedEffects).toEqual([{ kind: 'realtime.signal', error: '3 change signals were not sent this month.', attempts: 3, createdAt: '2026-10-04T07:00:00.000+03:00' }]);
    expect(q.asked.find((a) => a.text === SIGNALS_SQL)?.values).toEqual(['2026-10', '2026-10-03T06:00:00.000Z']);
  });

  it('gives the last run of the 15-minute job from its heartbeat, or null before the first run', async () => {
    expect((await readUsage(answering({}), testConfig(), NOW)).jobsLastRun).toBeNull();
    const ran = await readUsage(answering({ jobs: [{ done_at: new Date('2026-10-04T05:45:00Z') }] }), testConfig(), NOW);
    expect(ran.jobsLastRun).toBe('2026-10-04T08:45:00.000+03:00');
    expect(JOBS_LAST_RUN_SQL).toContain("'heartbeat'");
  });
});

describe('the meters of the 80% warning', () => {
  it('names each meter as the limitWarning mail of N2 does, with files on Supabase Storage or on R2', async () => {
    const meters = await readMeters(answering({}), testConfig(), NOW);
    expect(warningMeters(meters, 'supabase').map((m) => m.meter)).toEqual(['calls', 'database', 'files', 'backup', 'emailsToday', 'emailsMonth', 'egress']);
    expect(warningMeters(meters, 'r2').map((m) => m.meter)).toEqual(['calls', 'database', 'filesR2', 'backup', 'emailsToday', 'emailsMonth', 'egress']);
  });

  it('passes 80% at four fifths of the limit, not before', () => {
    expect(overLimit({ used: 79, limit: 100 })).toBe(false);
    expect(overLimit({ used: 80, limit: 100 })).toBe(true);
    expect(overLimit({ used: 0.8 * GB, limit: GB })).toBe(true);
  });
});
