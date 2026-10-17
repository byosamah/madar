import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { nodeOffice, NODE_TODAY } from '../../server/office/test/nodeOffice';
import { exportOffice } from '../backup/officeExport';
import { recordDigest } from './digest';
import { partsOps } from './ops';
import { exportSource, PG_SERVER_SQL, pgSource, stateSource } from './source';

const digests = (source: ReturnType<typeof stateSource>) => Object.fromEntries(source.tables.map((t) => [t.table, recordDigest(t.rows)]));

describe('the sources of an import (scripts/office/source.ts)', () => {
  it('gives every record of a State with its server columns, and the counters that hold the event numbers', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const source = stateSource(seed);
    const comments = source.tables.find((t) => t.table === 'comments')!;
    expect(comments.rows[0].columns).toHaveProperty('project_id');
    expect(source.records).toBe(source.tables.reduce((sum, t) => sum + t.rows.length, 0));
    expect(source.server.officeSeq).toBe(0);
    expect(source.server.counters.length).toBe(Object.keys(seed.counters).length);
    expect([...source.users].sort()).toEqual(Object.keys(seed.users).sort());
  });

  it('reads an export folder back into the same records as the office it came from', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed });
    const folder = mkdtempSync(join(tmpdir(), 'madar-source-test-'));
    await exportOffice(partsOps(t.parts), { copy: 'local', folder });
    const back = exportSource(folder, { today: NODE_TODAY });
    expect(digests(back)).toEqual(digests(stateSource(seed)));
    expect(back.server.officeSeq).toBe(Number((t.raw.prepare('select office_seq from office_meta').get() as { office_seq: number }).office_seq));
  });

  it('takes the people and their passwords from an export, and leaves out the sessions and the mail log before yesterday', async () => {
    const t = await nodeOffice();
    t.raw.exec("insert into auth_users (id, user_id, email, password_hash, password_set, email_confirmed, banned) values ('a1', 'usr_001', 'hala@madar.test', 'h', 1, 1, 0)");
    t.raw.exec("insert into auth_sessions (id, auth_id, amr, refresh_hash, expires_at) values ('s1', 'a1', 'password', 'r', '2026-10-05T00:00:00.000Z')");
    t.raw.exec("insert into mail_log (utc_day, kind, ref) values ('2026-10-01', 'notice', 'old'), ('2026-10-03', 'notice', 'yesterday'), ('2026-10-04', 'notice', 'today')");
    const folder = mkdtempSync(join(tmpdir(), 'madar-source-test-'));
    await exportOffice(partsOps(t.parts), { copy: 'local', folder });
    const back = exportSource(folder, { today: NODE_TODAY });
    expect(back.signin).toEqual([{ id: 'a1', email: 'hala@madar.test', password_hash: 'h', email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' }]);
    expect(back.server.mailLog.map((m) => m.ref).sort()).toEqual(['today', 'yesterday']);
  });

  it('reads Postgres inside one read-only snapshot, with numbers for bigint texts and ISO text for times', async () => {
    const texts: string[] = [];
    const rows: Record<string, Record<string, unknown>[]> = {
      [PG_SERVER_SQL.meta]: [{ version: '12', office_seq: '340' }],
      [PG_SERVER_SQL.personSeq]: [{ user_id: 'usr_001', seq: '41' }],
      [PG_SERVER_SQL.jobRuns]: [{ key: 'summary:2026-10-04', done_at: new Date('2026-10-04T04:31:00Z') }],
    };
    const source = await pgSource(async (text) => {
      texts.push(text);
      return rows[text] ?? [];
    });
    expect(texts[0]).toBe('begin isolation level repeatable read read only');
    expect(texts.at(-1)).toBe('commit');
    expect(source.server).toMatchObject({ version: 12, officeSeq: 340, personSeq: [{ user_id: 'usr_001', seq: 41 }], jobRuns: [{ key: 'summary:2026-10-04', done_at: '2026-10-04T04:31:00.000Z' }] });
  });

  it('rolls the snapshot back when a read of Postgres fails', async () => {
    const texts: string[] = [];
    await expect(pgSource(async (text) => {
      texts.push(text);
      if (text === PG_SERVER_SQL.counters) throw new Error('the read failed');
      return [];
    })).rejects.toThrow('the read failed');
    expect(texts.at(-1)).toBe('rollback');
    expect(texts).not.toContain('commit');
  });
});
