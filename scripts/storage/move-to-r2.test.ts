import { describe, expect, it } from 'vitest';
import {
  assertBeforeSwitch, copyMissing, envPlan, moveToR2, parseMoveArgs, r2Target, shellPlan, type MoveSource, type MoveTarget, type SourceObject,
} from './move-to-r2';

type Stored = { body: string; mimeType: string; etag: string };

function memorySource(objects: Map<string, Stored>, o: { onRead?: (key: string) => void } = {}): MoveSource {
  return {
    async list() {
      return [...objects].map(([key, v]): SourceObject => ({ key, size: v.body.length, etag: v.etag, mimeType: v.mimeType }));
    },
    async read(key) {
      o.onRead?.(key);
      const v = objects.get(key);
      return v ? { body: new TextEncoder().encode(v.body).buffer as ArrayBuffer, mimeType: v.mimeType } : null;
    },
  };
}

function memoryTarget(): MoveTarget & { objects: Map<string, { body: string; mimeType: string }>; writes: string[] } {
  const objects = new Map<string, { body: string; mimeType: string }>();
  const writes: string[] = [];
  return {
    objects,
    writes,
    async write(key, body, mimeType) {
      writes.push(key);
      objects.set(key, { body: new TextDecoder().decode(body), mimeType });
    },
    async head(key) {
      const v = objects.get(key);
      return v ? { size: v.body.length } : null;
    },
    async remove(keys) {
      for (const key of keys) objects.delete(key);
    },
    async list() {
      return [...objects.keys()];
    },
  };
}

const quiet = { log: () => {} };

describe('move-to-r2 (plan 2b, point 1)', () => {
  it('copies every object with the same key and type, and checks each size on the target', async () => {
    const source = new Map<string, Stored>([
      ['prj-001/fil-001/1/file', { body: '%PDF one', mimeType: 'application/pdf', etag: 'a' }],
      ['prj-001/fil-001/1/thumb', { body: 'webp', mimeType: 'image/webp', etag: 'b' }],
      ['feedback/upl-1/file', { body: 'png', mimeType: 'image/png', etag: 'c' }],
    ]);
    const target = memoryTarget();
    const report = await moveToR2(memorySource(source), target, quiet);
    expect([...target.objects.keys()].sort()).toEqual([...source.keys()].sort());
    expect(target.objects.get('prj-001/fil-001/1/file')).toEqual({ body: '%PDF one', mimeType: 'application/pdf' });
    expect(report).toEqual({ objects: 3, bytes: 15, firstPass: 3, secondPass: 0, removedFromTarget: 0, mismatched: [] });
  });

  it('keeps the stored type from the object list, not the type of the download answer', async () => {
    const source = new Map<string, Stored>([['a/b/1/file', { body: 'png', mimeType: 'image/png', etag: '1' }]]);
    const listed = memorySource(source);
    const served: MoveSource = { list: listed.list, read: async (key) => ({ ...(await listed.read(key))!, mimeType: 'text/plain' }) };
    const target = memoryTarget();
    await moveToR2(served, target, quiet);
    expect(target.objects.get('a/b/1/file')?.mimeType).toBe('image/png');
  });

  it('writes every download-only type as application/octet-stream, the same rule as an upload (storedMimeType)', async () => {
    const source = new Map<string, Stored>([
      ['a/b/1/file', { body: '<p>x</p>', mimeType: 'text/html', etag: '1' }],
      ['a/b/2/file', { body: '<svg/>', mimeType: 'image/svg+xml', etag: '2' }],
      ['a/b/3/file', { body: '%PDF', mimeType: 'application/pdf', etag: '3' }],
    ]);
    const target = memoryTarget();
    await moveToR2(memorySource(source), target, quiet);
    expect([...target.objects].map(([key, v]) => [key, v.mimeType])).toEqual([
      ['a/b/1/file', 'application/octet-stream'],
      ['a/b/2/file', 'application/octet-stream'],
      ['a/b/3/file', 'application/pdf'],
    ]);
  });

  it('removes from the target every key that the source no longer has, also one from an earlier run', async () => {
    const source = new Map<string, Stored>([['a/b/1/file', { body: 'one', mimeType: 'text/plain', etag: '1' }]]);
    const target = memoryTarget();
    // An earlier run copied a/b/9/file; a project delete then removed it from Storage.
    target.objects.set('a/b/9/file', { body: 'gone', mimeType: 'text/plain' });
    const report = await moveToR2(memorySource(source), target, quiet);
    expect([...target.objects.keys()]).toEqual(['a/b/1/file']);
    expect(report).toMatchObject({ objects: 1, removedFromTarget: 1, mismatched: [] });
  });

  it('refuses to run after the switch, when R2 is the store of the screens', () => {
    expect(() => assertBeforeSwitch({ MADAR_FILE_STORE: 'r2' })).toThrow(/after the switch/);
    expect(() => assertBeforeSwitch({ MADAR_FILE_STORE: ' R2 ' })).toThrow(/after the switch/);
    expect(() => assertBeforeSwitch({})).not.toThrow();
    expect(() => assertBeforeSwitch({ MADAR_FILE_STORE: 'supabase' })).not.toThrow();
  });

  it('copies again in the second pass the objects that changed or came during the first, and removes the ones that went', async () => {
    const source = new Map<string, Stored>([
      ['a/b/1/file', { body: 'one', mimeType: 'text/plain', etag: '1' }],
      ['a/b/2/file', { body: 'two', mimeType: 'text/plain', etag: '2' }],
      ['a/b/3/file', { body: 'three', mimeType: 'text/plain', etag: '3' }],
    ]);
    let changed = false;
    const target = memoryTarget();
    const report = await moveToR2(
      memorySource(source, {
        onRead: (key) => {
          // During the first pass, after the first copy: one object changes, one comes, one goes.
          if (key === 'a/b/2/file' && !changed) {
            changed = true;
            source.set('a/b/1/file', { body: 'one, changed', mimeType: 'text/plain', etag: '1b' });
            source.set('a/b/4/file', { body: 'four', mimeType: 'text/plain', etag: '4' });
            source.delete('a/b/3/file');
          }
        },
      }),
      target,
      quiet,
    );
    expect(target.objects.get('a/b/1/file')?.body).toBe('one, changed');
    expect(target.objects.get('a/b/4/file')?.body).toBe('four');
    expect(target.objects.has('a/b/3/file')).toBe(false);
    expect(report).toMatchObject({ objects: 3, firstPass: 2, secondPass: 2, removedFromTarget: 0, mismatched: [] });
  });

  it('removes from the target an object that the first pass copied and that went before the second pass', async () => {
    const source = new Map<string, Stored>([
      ['a/b/1/file', { body: 'one', mimeType: 'text/plain', etag: '1' }],
      ['a/b/2/file', { body: 'two', mimeType: 'text/plain', etag: '2' }],
    ]);
    const target = memoryTarget();
    const report = await moveToR2(memorySource(source, { onRead: (key) => key === 'a/b/2/file' && source.delete('a/b/1/file') }), target, quiet);
    expect([...target.objects.keys()]).toEqual(['a/b/2/file']);
    expect(report).toMatchObject({ objects: 1, firstPass: 2, secondPass: 0, removedFromTarget: 1, mismatched: [] });
  });

  it('names an object whose size on the target differs, so the run fails before the switch', async () => {
    const source = new Map<string, Stored>([['a/b/1/file', { body: 'one', mimeType: 'text/plain', etag: '1' }]]);
    const target = memoryTarget();
    const broken: MoveTarget = { ...target, write: async (key, _body, mimeType) => void target.objects.set(key, { body: 'o', mimeType }) };
    const report = await moveToR2(memorySource(source), broken, quiet);
    expect(report.mismatched).toEqual(['a/b/1/file']);
  });
});

const ACCOUNT = 'd76d34779c63849f5acdf3d6af3751cd';
const r2Lines = (bucket: string) =>
  `R2_ACCOUNT_ID=${ACCOUNT}\nR2_ACCESS_KEY_ID=key-id-value-5\nR2_SECRET_ACCESS_KEY=secret-value-5\nR2_BUCKET=${bucket}`;

describe('move-to-r2: the arguments (owner, 2026-10-16)', () => {
  it('takes --env test|production and --copy-only, and the old form with neither', () => {
    expect(parseMoveArgs([])).toEqual({ copyOnly: false });
    expect(parseMoveArgs(['--env', 'test'])).toEqual({ env: 'test', copyOnly: false });
    expect(parseMoveArgs(['--env', 'production', '--copy-only'])).toEqual({ env: 'production', copyOnly: true });
    expect(parseMoveArgs(['--copy-only'])).toEqual({ copyOnly: true });
  });

  it('refuses another copy and every other flag', () => {
    expect(() => parseMoveArgs(['--env', 'local'])).toThrow(/--env must be test or production/);
    expect(() => parseMoveArgs(['--env', 'test', '--force'])).toThrow(/--force is not an option/);
    expect(() => parseMoveArgs(['production'])).toThrow(/production is not an option/);
  });
});

describe('move-to-r2 --env: the plan of one copy', () => {
  it('reads the source from the fixed project and the target from the secrets file of that copy', () => {
    expect(envPlan({ env: 'test', copyOnly: false }, r2Lines('madar-files-test'), {})).toEqual({
      target: 'test', ref: 'qdgwpnesxppnqsaabqzd', supabaseUrl: 'https://qdgwpnesxppnqsaabqzd.supabase.co', sourceBucket: 'madar-files',
      r2: { accountId: ACCOUNT, accessKeyId: 'key-id-value-5', secretAccessKey: 'secret-value-5', bucket: 'madar-files-test' },
    });
    expect(envPlan({ env: 'production', copyOnly: false }, `FILES_BUCKET=madar-files\n${r2Lines('madar-files')}`, {})).toMatchObject({
      ref: 'oprkvdjudjxxhvodkzgs', supabaseUrl: 'https://oprkvdjudjxxhvodkzgs.supabase.co', r2: { bucket: 'madar-files' },
    });
  });

  it('refuses an R2_BUCKET that is not the bucket of that copy, before any network call', () => {
    expect(() => envPlan({ env: 'production', copyOnly: false }, r2Lines('madar-files-test'), {})).toThrow(/R2_BUCKET must be madar-files for production/);
    expect(() => envPlan({ env: 'test', copyOnly: true }, r2Lines('madar-files'), {})).toThrow(/R2_BUCKET must be madar-files-test for test/);
  });

  it('takes no R2 value and no endpoint from the shell: only the secrets file of the copy names the target', () => {
    const shell = { R2_BUCKET: 'madar-files', R2_ENDPOINT: 'http://127.0.0.1:9100', R2_ACCESS_KEY_ID: 'shell-key', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' };
    const plan = envPlan({ env: 'test', copyOnly: false }, r2Lines('madar-files-test'), shell);
    expect(plan.r2).toEqual({ accountId: ACCOUNT, accessKeyId: 'key-id-value-5', secretAccessKey: 'secret-value-5', bucket: 'madar-files-test' });
    expect(plan.supabaseUrl).toBe('https://qdgwpnesxppnqsaabqzd.supabase.co');
  });

  it('refuses the full move after the switch, by the secrets file or by the shell; --copy-only runs after it', () => {
    expect(() => envPlan({ env: 'test', copyOnly: false }, `MADAR_FILE_STORE=r2\n${r2Lines('madar-files-test')}`, {})).toThrow(/after the switch.*--copy-only/);
    expect(() => envPlan({ env: 'test', copyOnly: false }, r2Lines('madar-files-test'), { MADAR_FILE_STORE: 'r2' })).toThrow(/after the switch/);
    expect(envPlan({ env: 'test', copyOnly: true }, `MADAR_FILE_STORE=r2\n${r2Lines('madar-files-test')}`, {}).r2.bucket).toBe('madar-files-test');
  });

  it('refuses a secrets file with no R2 values', () => {
    expect(() => envPlan({ env: 'test', copyOnly: false }, 'MADAR_FILE_STORE=supabase', {})).toThrow(/has no R2 values/);
  });
});

describe('move-to-r2 in the old form: every value from the shell', () => {
  const shell = {
    SUPABASE_URL: 'http://127.0.0.1:54321', MADAR_SECRET_KEY: 'sb_secret_x', R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
    R2_BUCKET: 'madar-files', R2_ENDPOINT: 'http://127.0.0.1:9100',
  };

  it('keeps the shell values, FILES_BUCKET and R2_ENDPOINT, as before', () => {
    expect(shellPlan({ copyOnly: false }, shell)).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321', secretKey: 'sb_secret_x', sourceBucket: 'madar-files',
      r2: { accountId: 'local', accessKeyId: 'k', secretAccessKey: 's', bucket: 'madar-files', endpoint: 'http://127.0.0.1:9100' },
    });
    expect(shellPlan({ copyOnly: false }, { ...shell, FILES_BUCKET: 'madar-move-it' }).sourceBucket).toBe('madar-move-it');
  });

  it('names each missing value, and refuses the full move after the switch', () => {
    expect(() => shellPlan({ copyOnly: false }, { ...shell, MADAR_SECRET_KEY: undefined })).toThrow(/MADAR_SECRET_KEY is not set/);
    expect(() => shellPlan({ copyOnly: false }, { ...shell, MADAR_FILE_STORE: 'r2' })).toThrow(/after the switch/);
    expect(shellPlan({ copyOnly: true }, { ...shell, MADAR_FILE_STORE: 'r2' }).r2.bucket).toBe('madar-files');
  });
});

describe('move-to-r2 --copy-only: for after the switch', () => {
  /** A target that fails the test on any removal. */
  const keeping = (target: ReturnType<typeof memoryTarget>): MoveTarget => ({
    ...target,
    remove: async () => {
      throw new Error('copy-only removed a key');
    },
  });

  it('copies only the keys that R2 lacks, with the stored type, and never removes a key that the source lacks', async () => {
    const source = new Map<string, Stored>([
      ['a/b/1/file', { body: 'one', mimeType: 'application/pdf', etag: '1' }],
      ['a/b/2/file', { body: '<p>x</p>', mimeType: 'text/html', etag: '2' }],
    ]);
    const target = memoryTarget();
    target.objects.set('a/b/1/file', { body: 'one', mimeType: 'application/pdf' });
    // A file that people uploaded to R2 after the switch: Storage never had it.
    target.objects.set('c/d/1/file', { body: 'new on r2', mimeType: 'image/png' });
    const report = await copyMissing(memorySource(source), keeping(target), quiet);
    expect(target.writes).toEqual(['a/b/2/file']);
    expect(target.objects.get('a/b/2/file')).toEqual({ body: '<p>x</p>', mimeType: 'application/octet-stream' });
    expect(target.objects.get('c/d/1/file')?.body).toBe('new on r2');
    expect(report).toEqual({ objects: 2, alreadyOnTarget: 1, copied: 1, goneFromSource: 0, mismatched: [] });
  });

  it('never overwrites: a key that reaches R2 after the list stays as it is', async () => {
    const source = new Map<string, Stored>([['a/b/1/file', { body: 'storage', mimeType: 'text/plain', etag: '1' }]]);
    const target = memoryTarget();
    const late: MoveTarget = {
      ...keeping(target),
      async list() {
        const keys = await target.list();
        target.objects.set('a/b/1/file', { body: 'r2 copy', mimeType: 'text/plain' });
        return keys;
      },
    };
    const report = await copyMissing(memorySource(source), late, quiet);
    expect(target.writes).toEqual([]);
    expect(target.objects.get('a/b/1/file')?.body).toBe('r2 copy');
    expect(report).toMatchObject({ alreadyOnTarget: 1, copied: 0 });
  });

  it('skips a key that went from the source during the pass', async () => {
    const source = new Map<string, Stored>([['a/b/1/file', { body: 'one', mimeType: 'text/plain', etag: '1' }]]);
    const listed = memorySource(source);
    const going: MoveSource = { list: listed.list, read: async () => null };
    const target = memoryTarget();
    expect(await copyMissing(going, keeping(target), quiet)).toEqual({ objects: 1, alreadyOnTarget: 0, copied: 0, goneFromSource: 1, mismatched: [] });
  });

  it('names a copied key whose size on R2 differs, so the run exits 1', async () => {
    const source = new Map<string, Stored>([['a/b/1/file', { body: 'one', mimeType: 'text/plain', etag: '1' }]]);
    const target = memoryTarget();
    const broken: MoveTarget = { ...keeping(target), write: async (key, _body, mimeType) => void target.objects.set(key, { body: 'o', mimeType }) };
    expect((await copyMissing(memorySource(source), broken, quiet)).mismatched).toEqual(['a/b/1/file']);
  });
});

describe('r2Target', () => {
  it('signs each write for the EU endpoint of the account, and sends it with the fetch of the env', async () => {
    const seen: Request[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      seen.push(input as Request);
      return new Response('', { status: 200 });
    }) as typeof globalThis.fetch;
    const target = r2Target({ accountId: ACCOUNT, accessKeyId: 'key-id-value-5', secretAccessKey: 'secret-value-5', bucket: 'madar-files-test', fetch });
    await target.write('prj-001/fil-001/1/file', new TextEncoder().encode('%PDF').buffer as ArrayBuffer, 'application/pdf');
    expect(seen[0].method).toBe('PUT');
    expect(seen[0].url).toBe(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com/madar-files-test/prj-001/fil-001/1/file`);
    expect(seen[0].headers.get('content-type')).toBe('application/pdf');
    expect(seen[0].headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=key-id-value-5\//);
    expect(seen[0].headers.get('authorization')).not.toContain('secret-value-5');
  });
});
