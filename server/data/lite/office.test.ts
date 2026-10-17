import { describe, expect, it } from 'vitest';
import { emptyState } from '../../../src/api/store';
import { liteDb } from './db';
import { nodeHost } from './host';
import { userIdOfAuth } from '../officeCache';
import { partsOf, readLiteOffice, setLiteAuthLink, writeOfficeSnapshot, type OfficeLists } from './office';
import { DEFAULT_SETTINGS } from './schema';
import { freshLite } from './testDb';

const user = (id: string, nameAr = 'هالة') => ({ id, name: `Person ${id}`, nameAr, kind: 'human', active: true });

function listsWith(users: Record<string, unknown>): OfficeLists {
  return { ...emptyState(''), settings: DEFAULT_SETTINGS, users } as unknown as OfficeLists;
}

/** Writes one user row and the snapshot of that office at a new version, as a save does. */
async function writeOffice(db: Awaited<ReturnType<typeof freshLite>>['db'], users: Record<string, ReturnType<typeof user>>) {
  await db.tx('write', async (q) => {
    for (const rec of Object.values(users)) await q('insert into users (id, doc) values (?, ?) on conflict (id) do update set doc = excluded.doc', [rec.id, rec]);
    const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
    await writeOfficeSnapshot(q, listsWith(users), meta.version);
  });
}

describe('the office lists of a SQLite office (server/data/lite/office.ts)', () => {
  it('reads the office from the tables on a cold start with no snapshot', async () => {
    const { db } = await freshLite();
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(office.version).toBe(0);
    expect(office.lists.settings).toEqual(DEFAULT_SETTINGS);
    expect(office.lists.users).toEqual({});
  });

  it('keeps the office in memory: the next read sends only the version statement', async () => {
    const { db, log } = await freshLite();
    const first = await db.tx('read', (q) => readLiteOffice(db, q));
    log.length = 0;
    const second = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(second).toBe(first);
    expect(log).toEqual(['select version from office_meta where id = 1']);
  });

  it('reads the snapshot rows after a wake, and no office table', async () => {
    const { raw, db } = await freshLite();
    await writeOffice(db, { usr_001: user('usr_001') });
    const log: string[] = [];
    const woken = liteDb(nodeHost(raw, { log }));
    const office = await woken.tx('read', (q) => readLiteOffice(woken, q));
    expect(office.lists.users).toEqual({ usr_001: user('usr_001') });
    expect(log).toEqual(['select version from office_meta where id = 1', 'select version, body from office_snapshot order by part']);
  });

  it('loads the tables when the snapshot is older than office_meta (an office write outside the save)', async () => {
    const { raw, db } = await freshLite();
    await writeOffice(db, { usr_001: user('usr_001') });
    raw.exec(`insert into users (id, doc) values ('usr_002', '${JSON.stringify(user('usr_002'))}')`);
    raw.exec('update office_meta set version = version + 1');
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(Object.keys(office.lists.users)).toEqual(['usr_001', 'usr_002']);
  });

  it('splits a large office into parts under the row limit and reads it back equal', async () => {
    const { raw, db } = await freshLite();
    const users = Object.fromEntries(Array.from({ length: 900 }, (_, i) => {
      const id = `usr_${String(i + 1).padStart(3, '0')}`;
      return [id, user(id, `${'ش'.repeat(1_200)}😀`)];
    }));
    await writeOffice(db, users);
    const parts = raw.prepare('select count(*) as n, max(length(cast(body as blob))) as bytes from office_snapshot').get() as { n: number; bytes: number };
    expect(parts.n).toBeGreaterThan(1);
    expect(parts.bytes).toBeLessThan(2_000_000);
    const woken = liteDb(nodeHost(raw));
    expect((await woken.tx('read', (q) => readLiteOffice(woken, q))).lists.users).toEqual(users);
  });

  it('never cuts a surrogate pair between two parts', () => {
    expect(partsOf('ab😀cd', 3)).toEqual(['ab', '😀c', 'd']);
  });

  it('puts a snapshot into memory only after the commit: a rollback keeps the office of the database', async () => {
    const { db } = await freshLite();
    await expect(db.tx('write', async (q) => {
      await writeOfficeSnapshot(q, listsWith({ usr_009: user('usr_009') }), 5);
      throw new Error('stop');
    })).rejects.toThrow('stop');
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(office.version).toBe(0);
    expect(office.lists.users).toEqual({});
  });

  it('keeps nothing in memory from a read inside a transaction that wrote', async () => {
    const { db, log } = await freshLite();
    await db.tx('write', async (q) => {
      await q('insert into users (id, doc) values (?, ?)', ['usr_001', user('usr_001')]);
      await readLiteOffice(db, q);
      throw new Error('stop');
    }).catch(() => undefined);
    log.length = 0;
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(office.lists.users).toEqual({});
    expect(log).toContain('select version, body from office_snapshot order by part');
  });
});

describe('the sign-in links in the office snapshot (Supabase exit, wave 2)', () => {
  async function linked() {
    const { raw, db } = await freshLite();
    await writeOffice(db, { usr_001: user('usr_001'), usr_002: user('usr_002') });
    raw.exec("insert into auth_users (id, email) values ('auth-1', 'one@madar.test'), ('auth-2', 'two@madar.test')");
    expect(await db.tx('write', (q) => setLiteAuthLink(q, 'usr_001', 'auth-1'))).toBe(true);
    return { raw, db };
  }

  it('keeps the links in the snapshot, so a wake reads no sign-in row', async () => {
    const { raw } = await linked();
    const log: string[] = [];
    const woken = liteDb(nodeHost(raw, { log }));
    const office = await woken.tx('read', (q) => readLiteOffice(woken, q));
    expect(userIdOfAuth(office, 'auth-1')).toBe('usr_001');
    expect(log).toEqual(['select version from office_meta where id = 1', 'select version, body from office_snapshot order by part']);
  });

  it('raises the office version, moves a link to a new sign-in row and clears it', async () => {
    const { raw, db } = await linked();
    const before = (await db.tx('read', (q) => readLiteOffice(db, q))).version;
    await db.tx('write', (q) => setLiteAuthLink(q, 'usr_001', 'auth-2'));
    let office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(office.version).toBe(before + 1);
    expect([userIdOfAuth(office, 'auth-1'), userIdOfAuth(office, 'auth-2')]).toEqual([undefined, 'usr_001']);
    expect(raw.prepare('select id, user_id from auth_users order by id').all()).toEqual([{ id: 'auth-1', user_id: null }, { id: 'auth-2', user_id: 'usr_001' }]);
    await db.tx('write', (q) => setLiteAuthLink(q, 'usr_001', null));
    office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(userIdOfAuth(office, 'auth-2')).toBeUndefined();
  });

  it('keeps the links through a later write of an office list', async () => {
    const { raw, db } = await linked();
    await writeOffice(db, { usr_001: user('usr_001', 'هالة ناصر'), usr_002: user('usr_002') });
    const woken = liteDb(nodeHost(raw));
    expect(userIdOfAuth(await woken.tx('read', (q) => readLiteOffice(woken, q)), 'auth-1')).toBe('usr_001');
  });

  it('reads the links from the sign-in rows when the snapshot is older than office_meta', async () => {
    const { raw, db } = await linked();
    raw.exec("update auth_users set user_id = 'usr_002' where id = 'auth-2'");
    raw.exec('update office_meta set version = version + 1');
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(userIdOfAuth(office, 'auth-2')).toBe('usr_002');
  });

  it('keeps the old links in memory after a rollback', async () => {
    const { db } = await linked();
    await expect(db.tx('write', async (q) => {
      await setLiteAuthLink(q, 'usr_001', 'auth-2');
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(userIdOfAuth(await db.tx('read', (q) => readLiteOffice(db, q)), 'auth-1')).toBe('usr_001');
  });

  it('gives false and writes nothing for a person who is not in the office', async () => {
    const { raw, db } = await linked();
    const version = raw.prepare('select version from office_meta').get();
    expect(await db.tx('write', (q) => setLiteAuthLink(q, 'usr_404', 'auth-2'))).toBe(false);
    expect(raw.prepare('select version from office_meta').get()).toEqual(version);
  });

  it('never puts a sign-in id into the office lists that the calls read', async () => {
    const { db } = await linked();
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(JSON.stringify(office.lists)).not.toContain('auth-1');
  });
});
