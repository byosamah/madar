import { describe, expect, it } from 'vitest';
import { routeUrl, urlPattern } from '../tests/e2e-deploy/goto';
import { linkPath } from '../tests/e2e-deploy/mail';
import { appOrigin, databaseTarget, officeTarget, r2BucketTarget, supabaseTarget } from '../tests/e2e-deploy/targets';
import { isSignedFileLink, storeOfUpload } from '../tests/e2e-deploy/store';
import { functionsEnvLines, localOnly } from '../tests/e2e-deploy/local';
import { word } from '../tests/e2e-deploy/words';
import { closeTo, containShares, pngOf, WALK_PICTURE } from '../tests/e2e-deploy/picture';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { nodeHost } from '../server/data/lite/host';
import { applyLiteSchema } from '../server/data/lite/schema';
import { OFFICE_MAIL_SQL, OFFICE_SQL, OFFICE_SQL_NOT_NEEDED, officePeek } from '../tests/e2e-deploy/office';

/** The pure helpers of the browser checks on the test deployment (task X2). */

describe('routeUrl', () => {
  it('gives a path in the remote build and a hash link in the prototype', () => {
    expect(routeUrl('/', 'remote')).toBe('/');
    expect(routeUrl('/projects/prj_001?tab=tasks', 'remote')).toBe('/projects/prj_001?tab=tasks');
    expect(routeUrl('/', 'prototype')).toBe('/#/');
    expect(routeUrl('/projects/prj_001?tab=tasks', 'prototype')).toBe('/#/projects/prj_001?tab=tasks');
  });

  it('refuses a route that does not start with a slash or that is already a hash link', () => {
    expect(() => routeUrl('projects', 'remote')).toThrow(/starts with \//);
    expect(() => routeUrl('/#/projects', 'prototype')).toThrow(/hash/);
  });
});

describe('urlPattern', () => {
  it('matches the route as a path after the host in the remote build', () => {
    const pattern = urlPattern('/projects?filter=at_risk', { target: 'remote' });
    expect(pattern.test('http://127.0.0.1:4174/projects?filter=at_risk')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4174/#/projects?filter=at_risk')).toBe(false);
    expect(pattern.test('http://127.0.0.1:4174/sign-in?next=%2Fprojects%3Ffilter%3Dat_risk')).toBe(false);
  });

  it('matches the route after the hash in the prototype', () => {
    const pattern = urlPattern('/projects?filter=at_risk', { target: 'prototype' });
    expect(pattern.test('http://127.0.0.1:4173/#/projects?filter=at_risk')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4173/projects?filter=at_risk')).toBe(false);
  });

  it('can require the end of the address, as /#\\/dashboard$/ did', () => {
    const pattern = urlPattern('/dashboard', { target: 'remote', end: true });
    expect(pattern.test('https://madar-test.pages.dev/dashboard')).toBe(true);
    expect(pattern.test('https://madar-test.pages.dev/dashboard/meeting')).toBe(false);
    expect(urlPattern('/inbox/', { target: 'prototype' }).test('http://x/#/inbox/cnv_1')).toBe(true);
  });
});

describe('linkPath', () => {
  const app = 'http://127.0.0.1:4174';
  const text = 'Welcome, Lina\n\nhttp://127.0.0.1:4174/welcome?token_hash=abc123&type=invite\n\nThe link works once.';

  it('gives the path and query of the screen link in a mail text, when the link goes to the app of the run', () => {
    expect(linkPath(text, 'welcome', app)).toBe('/welcome?token_hash=abc123&type=invite');
    expect(linkPath('Set a new password: https://madar-test.pages.dev/reset?token_hash=z9&type=recovery', 'reset', 'https://madar-test.pages.dev')).toBe('/reset?token_hash=z9&type=recovery');
  });

  it('refuses a mail whose link sends the token to another origin', () => {
    expect(() => linkPath('https://madar.example.com/welcome?token_hash=abc123&type=invite', 'welcome', app)).toThrow(/https:\/\/madar\.example\.com, not to http:\/\/127\.0\.0\.1:4174/);
    expect(() => linkPath('http://127.0.0.1:5173/reset?token_hash=z9&type=recovery', 'reset', app)).toThrow(/not to http:\/\/127\.0\.0\.1:4174/);
  });

  it('refuses a mail without a link to that screen', () => {
    expect(() => linkPath(text, 'reset', app)).toThrow(/no link to \/reset/);
    expect(() => linkPath('No link here.', 'welcome', app)).toThrow(/no link to \/welcome/);
  });
});

describe('appOrigin', () => {
  it('is MADAR_E2E_APP_URL when set, else the base URL of the run', () => {
    expect(appOrigin({ MADAR_E2E_APP_URL: 'https://madar-test.pages.dev/' }, 'https://abc123.madar-test.pages.dev')).toBe('https://madar-test.pages.dev');
    expect(appOrigin({}, 'http://127.0.0.1:4174')).toBe('http://127.0.0.1:4174');
    expect(() => appOrigin({}, undefined)).toThrow(/MADAR_E2E_APP_URL/);
  });
});

describe('databaseTarget', () => {
  const POOLER = 'postgresql://postgres.qdgwpnesxppnqsaabqzd:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';

  it('uses the local database of the local stack by default, without TLS', () => {
    expect(databaseTarget({})).toEqual({ url: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', tls: false });
  });

  it('uses TLS for the database of madar-test and refuses the production project', () => {
    expect(databaseTarget({ MADAR_E2E_DATABASE_URL: POOLER }).tls).toBe(true);
    expect(databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres:pw@db.qdgwpnesxppnqsaabqzd.supabase.co:5432/postgres' }).tls).toBe(true);
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres.oprkvdjudjxxhvodkzgs:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' })).toThrow(/production/);
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres:pw@db.oprkvdjudjxxhvodkzgs.supabase.co:5432/postgres' })).toThrow(/production/);
  });

  it('reads only madar-test or the local stack, even when a password holds the ref of madar-test', () => {
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres' })).toThrow(/qdgwpnesxppnqsaabqzd/);
    expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: 'postgresql://someone:qdgwpnesxppnqsaabqzd@db.example.com:5432/postgres' })).toThrow(/qdgwpnesxppnqsaabqzd/);
  });

  it('refuses a URL with a TLS setting, because pg lets it replace the root certificate check (plan 4.5)', () => {
    for (const setting of ['sslmode=no-verify', 'sslmode=disable', 'ssl=0', 'sslrootcert=system', 'uselibpqcompat=true', 'SSLMODE=require']) {
      expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: `${POOLER}?${setting}` }), setting).toThrow(/TLS setting/);
      expect(() => databaseTarget({ MADAR_E2E_DATABASE_URL: `${POOLER}?application_name=x2&${setting}` }), setting).toThrow(/TLS setting/);
    }
  });

  it('stops a run on the test deployment that names no database, so it never reads the local stack by mistake', () => {
    expect(() => databaseTarget({ MADAR_DEPLOY_URL: 'https://preview.madar-test.pages.dev' })).toThrow('MADAR_E2E_DATABASE_URL is missing for the test deployment');
    expect(databaseTarget({ MADAR_DEPLOY_URL: 'https://preview.madar-test.pages.dev', MADAR_E2E_DATABASE_URL: POOLER }).url).toBe(POOLER);
  });
});

describe('supabaseTarget', () => {
  it('uses the local stack by default, and the MCP function of the project URL', () => {
    expect(supabaseTarget({})).toEqual({ supabaseUrl: 'http://127.0.0.1:54321', mcpUrl: 'http://127.0.0.1:54321/functions/v1/mcp' });
    expect(supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co/' })).toEqual({
      supabaseUrl: 'https://qdgwpnesxppnqsaabqzd.supabase.co', mcpUrl: 'https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/mcp',
    });
  });

  it('stops a run on the test deployment that names no project, before any call', () => {
    expect(() => supabaseTarget({ MADAR_DEPLOY_URL: 'https://preview.madar-test.pages.dev' })).toThrow('MADAR_E2E_SUPABASE_URL is missing for the test deployment');
  });

  it('refuses the production project and every project but madar-test, for the project and the MCP URL', () => {
    expect(() => supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://oprkvdjudjxxhvodkzgs.supabase.co' })).toThrow(/MADAR_E2E_SUPABASE_URL/);
    expect(() => supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' })).toThrow(/qdgwpnesxppnqsaabqzd/);
    expect(() => supabaseTarget({ MADAR_E2E_MCP_URL: 'https://oprkvdjudjxxhvodkzgs.supabase.co/functions/v1/mcp' })).toThrow(/MADAR_E2E_MCP_URL/);
    expect(() => supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co', MADAR_E2E_MCP_URL: 'https://mcp.example.com/mcp' })).toThrow(/MADAR_E2E_MCP_URL/);
    // The short address of production is never a target of the browser checks.
    expect(() => supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co', MADAR_E2E_MCP_URL: 'https://madar.vado.sa/mcp' })).toThrow(/MADAR_E2E_MCP_URL/);
  });

  it('takes the short MCP address of the test copy, the Pages forwarder to madar-test (2026-10-05)', () => {
    expect(supabaseTarget({ MADAR_E2E_SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co', MADAR_E2E_MCP_URL: 'https://preview.madar-46r.pages.dev/mcp' })).toEqual({
      supabaseUrl: 'https://qdgwpnesxppnqsaabqzd.supabase.co', mcpUrl: 'https://preview.madar-46r.pages.dev/mcp',
    });
  });
});

describe('word', () => {
  it('reads a text of either language from the base files and the files of the real build', () => {
    expect(word('en', 'auth.signOut')).toBe('Sign out');
    expect(word('en', 'settings.languages.ar')).toBe('العربية');
    expect(word('ar', 'auth.signOut')).not.toBe('Sign out');
    expect(word('ar', 'auth.signOut')).toMatch(/[؀-ۿ]/);
  });

  it('fills the placeholders and refuses a key that no file has', () => {
    expect(word('en', 'auth.welcome.greeting', { name: 'Lina' })).toBe('Welcome, Lina');
    expect(() => word('en', 'auth.nothing.here')).toThrow(/auth\.nothing\.here/);
  });
});

describe('localOnly', () => {
  it('accepts only the local stack', () => {
    expect(() => localOnly('http://127.0.0.1:54321')).not.toThrow();
    expect(() => localOnly('http://localhost:54321')).not.toThrow();
    expect(() => localOnly('https://qdgwpnesxppnqsaabqzd.supabase.co')).toThrow(/local stack/);
  });
});

describe('functionsEnvLines', () => {
  it('gives the local functions the address of the Mac for the file links, since they see Storage as http://kong:8000', () => {
    const lines = functionsEnvLines({ SECRET_KEY: 'sb_secret_local' });
    expect(lines.FILES_PUBLIC_URL).toBe('http://127.0.0.1:54321');
    expect(lines.AUTH_ISSUER).toBe('http://127.0.0.1:54321/auth/v1');
    expect(lines.MADAR_SECRET_KEY).toBe('sb_secret_local');
  });
});

describe('pngOf: the test picture of the walk, made at run time', () => {
  /** The chunks of a PNG: type, data, and whether the stored CRC matches. */
  function chunks(png: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
    const table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (bytes: Buffer) => {
      let c = 0xffffffff;
      for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const out: { type: string; data: Buffer; crcOk: boolean }[] = [];
    for (let at = 8; at < png.length;) {
      const length = png.readUInt32BE(at);
      const type = png.subarray(at + 4, at + 8).toString('latin1');
      const data = png.subarray(at + 8, at + 8 + length);
      out.push({ type, data, crcOk: png.readUInt32BE(at + 8 + length) === crc(png.subarray(at + 4, at + 8 + length)) });
      at += 12 + length;
    }
    return out;
  }

  it('writes a whole PNG: the signature, IHDR, IDAT and IEND, each with a right CRC', () => {
    const png = pngOf(3, 2, (x, y) => [x * 100, y * 200, 7]);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parts = chunks(png);
    expect(parts.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(parts.every((c) => c.crcOk)).toBe(true);
    const ihdr = parts[0].data;
    // 3 x 2, 8 bits, truecolour (2), deflate, no filter method, no interlace.
    expect([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ...ihdr.subarray(8)]).toEqual([3, 2, 8, 2, 0, 0, 0]);
  });

  it('stores each pixel as it was given, one filter byte 0 for each row', () => {
    const png = pngOf(3, 2, (x, y) => [x * 100, y * 200, 7]);
    const raw = inflateSync(chunks(png)[1].data);
    expect([...raw]).toEqual([0, 0, 0, 7, 100, 0, 7, 200, 0, 7, 0, 0, 200, 7, 100, 200, 7, 200, 200, 7]);
  });

  it('draws the walk picture in four colored quarters, which the preview check reads back', () => {
    const { width, height, quarters } = WALK_PICTURE;
    const png = WALK_PICTURE.png();
    const raw = inflateSync(chunks(png)[1].data);
    const at = (x: number, y: number) => [...raw.subarray(y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3)];
    for (const q of quarters) expect(at(Math.floor(q.x * width), Math.floor(q.y * height)), q.name).toEqual([...q.rgb]);
    expect(new Set(quarters.map((q) => q.rgb.join())).size).toBe(4);
  });

  it('compares a shown colour with some room for the scaling of the screen', () => {
    expect(closeTo([200, 40, 40], [210, 30, 52])).toBe(true);
    expect(closeTo([200, 40, 40], [255, 255, 255])).toBe(false);
  });

  it('moves the points onto a contained picture, which fills its box on one side only (the phone viewer)', () => {
    // A square picture in a 390 x 780 box: it shows 390 x 390, from y 195 to 585.
    const points = containShares({ width: 390, height: 780 }, { width: 64, height: 64 }, WALK_PICTURE.quarters);
    expect(points.map((p) => [p.x, p.y])).toEqual([[0.25, 0.375], [0.75, 0.375], [0.25, 0.625], [0.75, 0.625]]);
    // A box with the shape of the picture keeps the points.
    expect(containShares({ width: 200, height: 200 }, { width: 64, height: 64 }, WALK_PICTURE.quarters).map((p) => [p.x, p.y]))
      .toEqual(WALK_PICTURE.quarters.map((q) => [q.x, q.y]));
  });
});

describe('the file store of the walk (owner, 2026-10-16)', () => {
  const ACCOUNT = 'd76d34779c63849f5acdf3d6af3751cd';
  const R2_PUT = `https://${ACCOUNT}.eu.r2.cloudflarestorage.com/madar-files-test/up/upl-1/file?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc`;
  const STORAGE_PUT = 'https://qdgwpnesxppnqsaabqzd.supabase.co/storage/v1/object/upload/sign/madar-files/up/upl-1/file?token=x';

  it('names the store of an upload PUT by its host', () => {
    expect(storeOfUpload(R2_PUT)).toBe('r2');
    expect(storeOfUpload(STORAGE_PUT)).toBe('supabase');
    expect(storeOfUpload('http://127.0.0.1:54321/storage/v1/object/upload/sign/madar-files/up/upl-1/file?token=x')).toBe('supabase');
    expect(storeOfUpload('https://preview.madar-46r.pages.dev/api/batch')).toBeNull();
    expect(storeOfUpload(`https://${ACCOUNT}.r2.cloudflarestorage.com/madar-files-test/up/upl-1/file`)).toBeNull();
  });

  it('takes a signed download link of Storage or of the R2 test bucket as the fallback of the download', () => {
    expect(isSignedFileLink('https://qdgwpnesxppnqsaabqzd.supabase.co/storage/v1/object/sign/madar-files/prj-001/fil-001/1/file?token=x&download=a.pdf')).toBe(true);
    expect(isSignedFileLink(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com/madar-files-test/prj-001/fil-001/1/file?response-content-disposition=attachment&X-Amz-Signature=abc`)).toBe(true);
    // Not signed, another bucket, or not a file link.
    expect(isSignedFileLink(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com/madar-files-test/prj-001/fil-001/1/file`)).toBe(false);
    expect(isSignedFileLink(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com/madar-files/prj-001/fil-001/1/file?X-Amz-Signature=abc`)).toBe(false);
    expect(isSignedFileLink('https://preview.madar-46r.pages.dev/projects/prj_001?tab=files')).toBe(false);
  });

  it('reads R2 only in the test bucket, and only with the four R2 values; none gives n/a', () => {
    expect(r2BucketTarget({})).toBeNull();
    const values = { R2_ACCOUNT_ID: ACCOUNT, R2_ACCESS_KEY_ID: 'key-id-value-8', R2_SECRET_ACCESS_KEY: 'secret-value-8', R2_BUCKET: 'madar-files-test' };
    expect(r2BucketTarget(values)).toEqual({ accountId: ACCOUNT, accessKeyId: 'key-id-value-8', secretAccessKey: 'secret-value-8', bucket: 'madar-files-test' });
    expect(() => r2BucketTarget({ ...values, R2_BUCKET: 'madar-files' })).toThrow(/R2_BUCKET must be madar-files-test/);
    expect(() => r2BucketTarget({ R2_BUCKET: 'madar-files-test' })).toThrow(/R2 needs all of/);
  });
});

describe('the deploy suite on the office path (exit wave 4)', () => {
  it('takes the local office and the test copy, and refuses production and any other host', () => {
    expect(officeTarget({})).toBeNull();
    expect(officeTarget({ MADAR_E2E_OFFICE_URL: 'http://127.0.0.1:8792', MADAR_E2E_OPS_SECRET: 's' })).toEqual({ apiUrl: 'http://127.0.0.1:8792/api', mcpUrl: 'http://127.0.0.1:8792/mcp', opsSecret: 's' });
    expect(officeTarget({ MADAR_E2E_OFFICE_URL: 'https://preview.madar-46r.pages.dev', MADAR_E2E_OPS_SECRET: 's' })?.apiUrl).toBe('https://preview.madar-46r.pages.dev/api');
    expect(() => officeTarget({ MADAR_E2E_OFFICE_URL: 'https://madar.vado.sa', MADAR_E2E_OPS_SECRET: 's' })).toThrow('local office or the test copy');
    expect(() => officeTarget({ MADAR_E2E_OFFICE_URL: 'http://127.0.0.1:8792' })).toThrow('MADAR_E2E_OPS_SECRET is missing');
    expect(() => officeTarget({ MADAR_E2E_OFFICE_URL: 'http://127.0.0.1:8792', MADAR_E2E_OPS_SECRET: 's', MADAR_E2E_MCP_URL: 'https://madar.vado.sa/mcp' })).toThrow('host of MADAR_E2E_OFFICE_URL');
  });

  it('has an office form of every SQL text that the walk sends, with no Postgres form in it', () => {
    const walk = readFileSync(new URL('../tests/e2e-deploy/walk.spec.ts', import.meta.url), 'utf8');
    // Every string of the walk that starts with "select ": double-quoted ones may hold single quotes, single-quoted ones hold none.
    const texts = [...walk.matchAll(/"(select [^"]*)"/g), ...walk.matchAll(/'(select [^']*)'/g)].map((m) => m[1]);
    expect(texts.length).toBeGreaterThan(10);
    for (const text of new Set(texts)) {
      if (OFFICE_SQL_NOT_NEEDED.includes(text)) continue;
      expect(OFFICE_SQL[text], text).toBeDefined();
      expect(OFFICE_SQL[text], text).not.toMatch(/::|\$\d|->>|doc->/);
    }
  });

  it('gives forms that the SQLite schema of the office object takes, the mail texts among them', async () => {
    const raw = new DatabaseSync(':memory:');
    await applyLiteSchema(nodeHost(raw));
    for (const form of [...Object.values(OFFICE_SQL), ...Object.values(OFFICE_MAIL_SQL)]) {
      expect(() => raw.prepare(form), form).not.toThrow();
    }
    raw.close();
  });

  it('reads a list of ids as JSON and gives a list back, in user order, only from the count asked', async () => {
    const raw = new DatabaseSync(':memory:');
    await applyLiteSchema(nodeHost(raw));
    const add = raw.prepare('insert into notifications (id, doc, user_id, read, target_id) values (?, ?, ?, ?, ?)');
    add.run('ntf_2', JSON.stringify({ trigger: 'feedback_sent' }), 'usr_009', 1, 'fbk_1');
    add.run('ntf_1', JSON.stringify({ trigger: 'feedback_sent' }), 'usr_001', 0, 'fbk_1');
    const notices = "select array_agg(id order by user_id) as ids, array_agg(user_id order by user_id) as users from notifications where target_id = $1 and doc->>'trigger' = 'feedback_sent' having count(*) >= $2";
    expect(raw.prepare(OFFICE_SQL[notices]).all('fbk_1', 2)).toEqual([{ ids: '["ntf_1","ntf_2"]', users: '["usr_001","usr_009"]' }]);
    expect(raw.prepare(OFFICE_SQL[notices]).all('fbk_1', 3)).toEqual([]);
    const read = 'select 1 from notifications where id = any($1) and user_id = $2 and read';
    expect(raw.prepare(OFFICE_SQL[read]).all(JSON.stringify(['ntf_1', 'ntf_2']), 'usr_009')).toHaveLength(1);
    expect(raw.prepare(OFFICE_SQL[read]).all(JSON.stringify(['ntf_1']), 'usr_001')).toHaveLength(0);
    raw.close();
  });

  it('peeks with the ops secret in the header only, sends a list as JSON and a time as ISO text, and reads the JSON columns back', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Response.json([{ id: 'ntf_1', ids: '["a","b"]', users: '["usr_001"]', mail: '{"subject":"Hi"}', n: '2' }]);
    }) as unknown as typeof fetch;
    const target = { apiUrl: 'http://127.0.0.1:8792/api', mcpUrl: 'http://127.0.0.1:8792/mcp', opsSecret: 'ops-secret-value' };
    const rows = await officePeek(target, 'select 1', [['a', 'b'], new Date('2026-10-04T06:00:00Z'), 3], fetcher);
    expect(rows).toEqual([{ id: 'ntf_1', ids: ['a', 'b'], users: ['usr_001'], mail: { subject: 'Hi' }, n: '2' }]);
    expect(seen[0].url).toBe('http://127.0.0.1:8792/api/office/peek');
    expect(new Headers(seen[0].init.headers).get('x-madar-ops-secret')).toBe('ops-secret-value');
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ text: 'select 1', values: ['["a","b"]', '2026-10-04T06:00:00.000Z', 3] });
    expect(String(seen[0].init.body)).not.toContain('ops-secret-value');
    const refused = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch;
    await expect(officePeek(target, 'select 1', [], refused)).rejects.toThrow('The peek route answered 403.');
  });
});
