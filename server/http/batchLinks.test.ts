import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { WireResponse } from '../../src/api/remote/wire';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { prefetchLinkRun } from '../calls/files';
import { createRunCall } from '../core/runCall';
import { memoryData } from '../core/memoryData';
import { fakeFilesDb } from '../files/fakeFilesDb';
import { FILE_DOC_SQL, FILES_DOCS_SQL } from '../files/records';
import { fakeDeps } from '../test/fakes/deps';
import { apiApp, type AppOptions } from './app';

/**
 * A run of adjacent files.link entries reads its files with one statement (performance audit SV-11). Before: each entry ran
 * db.statement('read'), which is begin, select, commit on the one read connection, so 12 links cost 36 statements in a row.
 * The answers, their order and each error stay as they were.
 */

const verify: AppOptions['verifyToken'] = async (header) => {
  if (header !== 'Bearer good') throw new ApiError('unauthenticated', 'Sign in again.');
  return { authUserId: 'auth-1' };
};

const version = (letter: string) => ({
  letter, blobKey: `prj-001/upl-${letter.toLowerCase()}/file`, mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_002', uploadedAt: '2026-10-04T09:00:00+03:00',
});
const file = (id: string, name: string) => ({ id, projectId: 'prj_001', name, versions: [version('A')] });
const FILES = { fil_001: file('fil_001', 'A.pdf'), fil_002: file('fil_002', 'B.pdf'), fil_003: file('fil_003', 'C.pdf') };

const link = (i: number, id: string) => ({ i, name: 'files.link', input: { id, variant: 'full', disposition: 'inline' } });

describe('a run of files.link entries (SV-11)', () => {
  let seed: State;
  beforeAll(async () => {
    seed = await buildSeed('2026-10-04', async () => undefined);
  });

  function harness(prefetch: boolean) {
    const mem = memoryData(seed);
    const data = mem.data();
    const filesDb = fakeFilesDb({ files: structuredClone(FILES) as never });
    const deps = fakeDeps({ db: filesDb });
    const app = apiApp(deps, {
      runCall: createRunCall({ data: () => data }),
      verifyToken: verify,
      principalOf: () => ({ userId: 'usr_001' }),
      readOffice: async () => data.office(),
      prefetchRun: prefetch ? prefetchLinkRun : undefined,
    });
    const send = async (calls: unknown[]) =>
      (await (await app.fetch(new Request('http://127.0.0.1/batch', { method: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ v: 1, calls }) }))).json()) as WireResponse;
    const count = (text: string) => filesDb.statements.filter((s) => s === text).length;
    return { send, count };
  }

  const run = [link(0, 'fil_001'), link(1, 'fil_002'), link(2, 'fil_404'), link(3, 'fil_001'), link(4, 'fil_003')];
  const urlsOf = (body: WireResponse) => JSON.parse(JSON.stringify(body.results).replace(/"url":"[^"]*"/g, '"url":"u"').replace(/"expiresAt":"[^"]*"/g, '"expiresAt":"t"'));

  it('reads the files of the whole run with one statement, not one for each link', async () => {
    const h = harness(true);
    await h.send(run);
    expect(h.count(FILES_DOCS_SQL)).toBe(1);
    expect(h.count(FILE_DOC_SQL)).toBe(0);
  });

  it('gives the same answers in the same order as one read for each link, a missing file included', async () => {
    const before = harness(false);
    const after = harness(true);
    const a = await before.send(run);
    const b = await after.send(run);
    expect(before.count(FILE_DOC_SQL)).toBe(5);
    expect(urlsOf(b)).toEqual(urlsOf(a));
    expect(b.results.map((r) => [r.i, r.ok])).toEqual([[0, true], [1, true], [2, false], [3, true], [4, true]]);
    expect(b.results[2]).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('keeps one read for a single link, and for links that a read separates', async () => {
    const single = harness(true);
    await single.send([link(0, 'fil_001')]);
    expect(single.count(FILES_DOCS_SQL)).toBe(0);
    expect(single.count(FILE_DOC_SQL)).toBe(1);
    const apart = harness(true);
    await apart.send([link(0, 'fil_001'), { i: 1, name: 'projects.get', input: { id: 'prj_001' } }, link(2, 'fil_002')]);
    expect(apart.count(FILES_DOCS_SQL)).toBe(0);
    expect(apart.count(FILE_DOC_SQL)).toBe(2);
  });

  it('forgets the read files after the run, so a later link reads again', async () => {
    const h = harness(true);
    await h.send([link(0, 'fil_001'), link(1, 'fil_002'), { i: 2, name: 'projects.get', input: { id: 'prj_001' } }, link(3, 'fil_003')]);
    expect(h.count(FILES_DOCS_SQL)).toBe(1);
    expect(h.count(FILE_DOC_SQL)).toBe(1);
  });
});
