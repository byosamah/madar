import { describe, expect, it } from 'vitest';
import { KEYS_IN_USE_SQL } from '../../server/files/effects';
import { countsSql, keyPlaces, managementQuery, parseVerifyArgs, recordKeysSql, runVerify, verifyKeys } from './verify-r2-keys';

/** scripts/storage/verify-r2-keys.ts on fakes (owner, 2026-10-16): every key that a record names has an object on R2. */

const ACCOUNT = 'd76d34779c63849f5acdf3d6af3751cd';
const R2 = { accountId: ACCOUNT, accessKeyId: 'key-id-value-6', secretAccessKey: 'secret-value-6', bucket: 'madar-files-test' };

describe('the keys that the records name', () => {
  it('reads the places of the keys from KEYS_IN_USE_SQL, so the check and the r2.delete handler name the same keys', () => {
    expect(keyPlaces()).toEqual([
      { table: 'files', array: 'versions', field: 'blobKey' },
      { table: 'files', array: 'versions', field: 'thumbKey' },
      { table: 'feedback', array: 'screenshots', field: 'blobKey' },
    ]);
  });

  it('refuses a KEYS_IN_USE_SQL that it cannot read, so a change there never gives an empty check', () => {
    expect(() => keyPlaces('select 1')).toThrow(/KEYS_IN_USE_SQL/);
  });

  it('builds read-only queries: every key of each place, and the record count of each table', () => {
    const keys = recordKeysSql(keyPlaces());
    expect(keys).toMatch(/^select distinct key from \(/);
    expect(keys).toContain("e->>'blobKey' as key from files t cross join lateral jsonb_array_elements(");
    expect(keys).toContain("e->>'thumbKey' as key from files t");
    expect(keys).toContain("e->>'blobKey' as key from feedback t");
    expect(keys).toContain("t.doc->'screenshots'");
    expect(countsSql(keyPlaces())).toBe('select (select count(*) from files)::int as files, (select count(*) from feedback)::int as feedback');
    for (const sql of [keys, countsSql(keyPlaces())]) expect(sql).not.toMatch(/\b(insert|update|delete|drop|truncate|alter|create|grant)\b/i);
    expect(KEYS_IN_USE_SQL).toContain("'thumbKey', k");
  });
});

describe('managementQuery', () => {
  it('posts the query to the SQL endpoint of the project as a read-only query, with the token', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return Response.json([{ key: 'prj-001/fil-001/1/file' }], { status: 201 });
    }) as typeof fetch;
    expect(await managementQuery('qdgwpnesxppnqsaabqzd', 'sbp_token_6', 'select 1', fetcher)).toEqual([{ key: 'prj-001/fil-001/1/file' }]);
    expect(seen[0].url).toBe('https://api.supabase.com/v1/projects/qdgwpnesxppnqsaabqzd/database/query');
    expect(seen[0].init?.method).toBe('POST');
    expect(new Headers(seen[0].init?.headers).get('authorization')).toBe('Bearer sbp_token_6');
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ query: 'select 1', read_only: true });
  });

  it('names the status, never the token, and refuses an answer that is not a list of rows', async () => {
    const refused = (async () => new Response('{"message":"no"}', { status: 401 })) as unknown as typeof fetch;
    const error = await managementQuery('qdgwpnesxppnqsaabqzd', 'sbp_token_6', 'select 1', refused).catch((e: unknown) => String(e));
    expect(error).toMatch(/refused the query with 401/);
    expect(error).not.toContain('sbp_token_6');
    const odd = (async () => Response.json({ rows: [] }, { status: 201 })) as unknown as typeof fetch;
    await expect(managementQuery('qdgwpnesxppnqsaabqzd', 'sbp_token_6', 'select 1', odd)).rejects.toThrow(/no list of rows/);
  });
});

describe('verifyKeys', () => {
  it('heads each key once on R2 and names the missing keys and the keys that are not object keys', async () => {
    const heads: string[] = [];
    const stored = new Set(['prj-001/fil-001/1/file', 'prj-001/fil-001/1/thumb']);
    const result = await verifyKeys(
      ['prj-001/fil-001/1/file', 'prj-001/fil-001/1/thumb', 'prj-001/fil-002/1/file', 'prj-001/fil-001/1/file', 'blob_seed_001'],
      async (key) => (heads.push(key), stored.has(key) ? { size: 1 } : null),
    );
    expect(heads.sort()).toEqual(['prj-001/fil-001/1/file', 'prj-001/fil-001/1/thumb', 'prj-001/fil-002/1/file']);
    expect(result).toEqual({ keys: 4, present: 2, missing: ['prj-001/fil-002/1/file'], notObjectKeys: ['blob_seed_001'] });
  });

  it('runs at most 8 heads at once', async () => {
    let running = 0;
    let most = 0;
    const keys = Array.from({ length: 30 }, (_, i) => `prj-001/fil-${String(i).padStart(3, '0')}/1/file`);
    await verifyKeys(keys, async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return { size: 1 };
    });
    expect(most).toBe(8);
  });
});

describe('parseVerifyArgs', () => {
  it('needs --env test or --env production, and takes no other flag', () => {
    expect(parseVerifyArgs(['--env', 'production'])).toEqual({ env: 'production' });
    expect(() => parseVerifyArgs([])).toThrow(/--env test or --env production/);
    expect(() => parseVerifyArgs(['--env', 'test', '--fix'])).toThrow(/--fix is not an option/);
  });
});

describe('runVerify', () => {
  const query = (keys: string[]) => async (sql: string) => (sql.startsWith('select (select count') ? [{ files: 3, feedback: 1 }] : keys.map((key) => ({ key })));

  it('reports the counts and exits 0 when every key has an object on R2', async () => {
    const result = await runVerify({ target: 'test', fileStore: 'r2', r2: R2, query: query(['prj-001/fil-001/1/file', 'feedback/upl-1/file']), head: async () => ({ size: 1 }) });
    expect(result).toEqual({
      code: 0,
      report: { env: 'test', bucket: 'madar-files-test', fileStore: 'r2', records: { files: 3, feedback: 1 }, keys: 2, present: 2, missing: [], notObjectKeys: [] },
    });
  });

  it('exits 1 and names each missing key', async () => {
    const result = await runVerify({ target: 'test', fileStore: 'r2', r2: R2, query: query(['prj-001/fil-001/1/file', 'feedback/upl-1/file']), head: async (key) => (key.startsWith('feedback') ? null : { size: 1 }) });
    expect(result.code).toBe(1);
    expect(result.report.missing).toEqual(['feedback/upl-1/file']);
    expect(JSON.stringify(result.report)).not.toContain('secret-value-6');
  });

  it('exits 1 for a key that is not an object key: no store holds it', async () => {
    const result = await runVerify({ target: 'test', fileStore: 'supabase', r2: R2, query: query(['blob_seed_001']), head: async () => ({ size: 1 }) });
    expect(result).toMatchObject({ code: 1, report: { fileStore: 'supabase', notObjectKeys: ['blob_seed_001'] } });
  });
});
