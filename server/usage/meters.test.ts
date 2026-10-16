import { describe, expect, it } from 'vitest';
import { serverContracts } from '../../src/api/contract/server';
import { CLAIM_SQL } from '../core/effects';
import type { Query } from '../core/ports';
import { SENT_TODAY_SQL } from '../mail/quota';
import { testConfig } from '../test/fakes/deps';
import { FAILED_EFFECTS_SQL, JOBS_LAST_RUN_SQL, METERS_SQL, SIGNALS_SQL, STORAGE_BYTES_SQL, STORAGE_PRESENT_SQL, overLimit, readMeters, readUsage, warningMeters } from './meters';

/**
 * The usage meters (plan 5.8; task M1). A small answer table in memory gives the rows of each exported statement, so these tests
 * check the shape and the rules; server/it/usage.it.test.ts runs the same statements on the local database.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const GB = 1024 * 1024 * 1024;

type Answers = Partial<Record<'meters' | 'today' | 'failed' | 'signals' | 'jobs' | 'present' | 'storage', Record<string, unknown>[]>>;

function answering(answers: Answers): Query & { asked: { text: string; values: unknown[] }[] } {
  const asked: { text: string; values: unknown[] }[] = [];
  const q = (async (text: string, values: unknown[] = []) => {
    asked.push({ text, values });
    if (text === METERS_SQL) return answers.meters ?? [{ calls: '0', bytes_read: '0', backup_bytes: null, database_bytes: '0', files_bytes: '0', emails_month: '0' }];
    if (text === SENT_TODAY_SQL) return answers.today ?? [{ n: 0 }];
    if (text === FAILED_EFFECTS_SQL) return answers.failed ?? [];
    if (text === SIGNALS_SQL) return answers.signals ?? [];
    if (text === JOBS_LAST_RUN_SQL) return answers.jobs ?? [];
    // The db-mode harness has no platform files, so by default the bucket function is not there.
    if (text === STORAGE_PRESENT_SQL) return answers.present ?? [{ present: false }];
    if (text === STORAGE_BYTES_SQL) return answers.storage ?? [];
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

  it('uses the calls limit of the host that serves the copy: 10 million on Workers Paid, 500,000 on Supabase (owner, 2026-10-16)', async () => {
    expect((await readMeters(answering({}), testConfig({ servingHost: 'workers' }), NOW)).calls.limit).toBe(10_000_000);
    expect((await readMeters(answering({}), testConfig({ servingHost: 'supabase' }), NOW)).calls.limit).toBe(500_000);
    expect((await readMeters(answering({}), testConfig(), NOW)).calls.limit).toBe(500_000);
  });

  it('uses the limit of the active store: 10 GB on R2', async () => {
    const meters = await readMeters(answering({}), testConfig({ fileStore: 'r2', limits: { maxFileBytes: 250 * 1024 * 1024, filesTotalBytes: 10 * GB } }), NOW);
    expect(meters.files.limit).toBe(10 * GB);
  });

  it('reads file storage from the bucket while the files are on Supabase Storage: deleted files, thumbnails and screenshots stay there', async () => {
    const q = answering({
      meters: [{ calls: '0', bytes_read: '0', backup_bytes: null, database_bytes: '0', files_bytes: String(GB / 2), emails_month: '0' }],
      present: [{ present: true }],
      storage: [{ bytes: String(0.9 * GB) }],
    });
    const meters = await readMeters(q, testConfig(), NOW);
    expect(meters.files).toEqual({ used: 0.9 * GB, limit: GB });
    expect(STORAGE_BYTES_SQL).toBe('select madar_private.storage_bytes() as bytes');
  });

  it('falls back to the file records on Supabase Storage when the bucket function does not exist (the db-mode harness)', async () => {
    const q = answering({ meters: [{ calls: '0', bytes_read: '0', backup_bytes: null, database_bytes: '0', files_bytes: '4096', emails_month: '0' }] });
    const meters = await readMeters(q, testConfig(), NOW);
    expect(meters.files.used).toBe(4096);
    expect(q.asked.map((a) => a.text)).not.toContain(STORAGE_BYTES_SQL);
  });

  it('counts the file records on R2 and never asks the bucket of Supabase Storage', async () => {
    const q = answering({
      meters: [{ calls: '0', bytes_read: '0', backup_bytes: null, database_bytes: '0', files_bytes: String(3 * GB), emails_month: '0' }],
      present: [{ present: true }],
      storage: [{ bytes: '1' }],
    });
    const meters = await readMeters(q, testConfig({ fileStore: 'r2', limits: { maxFileBytes: 250 * 1024 * 1024, filesTotalBytes: 10 * GB } }), NOW);
    expect(meters.files).toEqual({ used: 3 * GB, limit: 10 * GB });
    expect(q.asked.map((a) => a.text)).not.toContain(STORAGE_PRESENT_SQL);
    expect(q.asked.map((a) => a.text)).not.toContain(STORAGE_BYTES_SQL);
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

  it('leaves out the rows that wait for a time they named (a full mail day), and keeps the rows that failed in the normal way', () => {
    // A failed attempt keeps the claim of CLAIM_SQL (now + 2 minutes) at most; WAIT_SQL holds the row until the time it named,
    // the next UTC midnight for QuotaFull. The emails meter tells the Admin about a full day, and a Retry cannot help before
    // midnight. server/it/usage.it.test.ts runs it on the local database.
    expect(CLAIM_SQL).toContain("claimed_until = now() + interval '2 minutes'");
    expect(FAILED_EFFECTS_SQL).toContain("and not coalesce(claimed_until > now() + interval '2 minutes', false)");
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
    // On the Worker the calls meter has its own name, so its mail names the Workers next step (owner, 2026-10-16).
    expect(warningMeters(meters, 'r2', 'workers').map((m) => m.meter)).toEqual(['callsWorkers', 'database', 'filesR2', 'backup', 'emailsToday', 'emailsMonth', 'egress']);
    expect(warningMeters(meters, 'supabase', 'supabase')[0].meter).toBe('calls');
  });

  it('passes 80% at four fifths of the limit, not before', () => {
    expect(overLimit({ used: 79, limit: 100 })).toBe(false);
    expect(overLimit({ used: 80, limit: 100 })).toBe(true);
    expect(overLimit({ used: 0.8 * GB, limit: GB })).toBe(true);
  });
});
