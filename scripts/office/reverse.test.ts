import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { NODE_TODAY } from '../../server/office/test/nodeOffice';
import { RECORD_DELETES_SQL, TRUNCATE_SQL } from '../seed-test-office';
import { REVERSE_JOB_RUNS_SQL, REVERSE_MAIL_LOG_SQL, reverseExport, stateOfSource } from './reverse';
import { stateSource } from './source';

type Sent = { text: string; values: unknown[] };

function fakePostgres(known: string[] = []) {
  const sent: Sent[] = [];
  const query = async (text: string, values: unknown[] = []) => {
    sent.push({ text, values });
    if (text.startsWith('select id::text as id from auth.users')) return known.map((id) => ({ id }));
    if (text.includes('returning')) return [{ version: 1, office_seq: 1, user_id: 'usr_001', seq: 1, id: 'usr_001' }];
    return [];
  };
  return { sent, texts: () => sent.map((s) => s.text), query };
}

describe('the reverse export (scripts/office/reverse.ts)', () => {
  it('makes the State of a source back, with every record and the counters', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const state = stateOfSource(stateSource(seed), NODE_TODAY);
    expect(state.tasks).toEqual(seed.tasks);
    expect(state.settings).toEqual(seed.settings);
    expect(state.counters).toEqual(seed.counters);
  });

  it('writes in one transaction under the office lock: the deletes record, the tables empty, then the office, then the links', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const pg = fakePostgres(['11111111-1111-4111-8111-111111111111']);
    const source = stateSource(seed, { signin: [
      { id: '11111111-1111-4111-8111-111111111111', email: 'a@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' },
      { id: '22222222-2222-4222-8222-222222222222', email: 'new@madar.test', password_hash: 'pbkdf2-sha256$100000$x$y', email_confirmed: true, banned: false, password_set: true, user_id: 'usr_002' },
    ] });
    const report = await reverseExport(pg.query, source, { lockKey: 7_310_001, today: NODE_TODAY });
    const texts = pg.texts();
    expect(texts[0]).toBe('begin');
    expect(texts).toContain(RECORD_DELETES_SQL);
    expect(texts).toContain(TRUNCATE_SQL);
    expect(texts.indexOf(RECORD_DELETES_SQL)).toBeLessThan(texts.indexOf(TRUNCATE_SQL));
    expect(texts.at(-1)).toBe('commit');
    expect(report.needInvite).toEqual([{ userId: 'usr_002', email: 'new@madar.test' }]);
    expect(report.linked).toBe(1);
  });

  it('takes the job runs and the mail log of the day back too, so Supabase sends no second morning summary', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const pg = fakePostgres();
    const source = stateSource(seed, { server: {
      jobRuns: [{ key: `summary:${NODE_TODAY}`, done_at: '2026-10-04T04:31:00.000Z' }],
      mailLog: [{ utc_day: NODE_TODAY, kind: 'summary', user_id: 'usr_001', ref: `summary-${NODE_TODAY}-usr_001`, resend_id: 're_1', created_at: '2026-10-04T04:31:00.000Z' }],
    } });
    await reverseExport(pg.query, source, { lockKey: 7_310_001, today: NODE_TODAY });
    expect(pg.sent.find((s) => s.text === REVERSE_JOB_RUNS_SQL)?.values).toEqual([`summary:${NODE_TODAY}`, '2026-10-04T04:31:00.000Z']);
    expect(pg.sent.find((s) => s.text === REVERSE_MAIL_LOG_SQL)?.values).toEqual([NODE_TODAY, 'summary', 'usr_001', `summary-${NODE_TODAY}-usr_001`, 're_1', '2026-10-04T04:31:00.000Z']);
    expect(pg.texts().indexOf(REVERSE_JOB_RUNS_SQL)).toBeGreaterThan(pg.texts().indexOf(TRUNCATE_SQL));
  });

  it('rolls back and writes no commit when a statement fails', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const sent: string[] = [];
    await expect(reverseExport(async (text) => {
      sent.push(text);
      if (text === TRUNCATE_SQL) throw new Error('lock timeout');
      return [];
    }, stateSource(seed), { lockKey: 7_310_001, today: NODE_TODAY })).rejects.toThrow('lock timeout');
    expect(sent.at(-1)).toBe('rollback');
    expect(sent).not.toContain('commit');
  });
});
