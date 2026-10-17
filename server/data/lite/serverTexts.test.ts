import { describe, expect, it } from 'vitest';
import { USER_EMAIL_CHANGED_LITE } from '../../auth/effects';
import { blobKeysInUse, projectBlobKeys } from '../../files/effects';
import { insertIntents, readIntents, useIntents } from '../../files/intents';
import { readFeedback, readFile, readUsers } from '../../files/records';
import { freshLite } from './testDb';

const NOW = new Date('2026-10-04T06:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe('the file texts and the email producer on SQLite', () => {
  it('writes, reads and uses upload intents once, and refuses an ended one', async () => {
    const { db } = await freshLite();
    const intent = (id: string, expiresAt: Date) => ({ id, actorId: 'usr_001', projectId: 'prj_001', stagingKey: `staging/${id}`, key: `files/${id}`, thumbKey: null, size: 10, mimeType: 'application/pdf', expiresAt, usedAt: null });
    await insertIntents(db, [intent('upl_a', later(60_000)), intent('upl_b', later(-1))]);
    const read = await readIntents(db, ['upl_a', 'upl_b']);
    expect(read.get('upl_a')).toEqual(intent('upl_a', later(60_000)));
    await db.tx('write', (q) => useIntents(q, ['upl_a'], 'usr_001', NOW));
    await expect(db.tx('write', (q) => useIntents(q, ['upl_a'], 'usr_001', NOW))).rejects.toMatchObject({ code: 'conflict' });
    await expect(db.tx('write', (q) => useIntents(q, ['upl_b'], 'usr_001', NOW))).rejects.toMatchObject({ code: 'conflict' });
  });

  it('reads the records of the file hooks', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await q('insert into users (id, doc) values (?, ?)', ['usr_001', { id: 'usr_001', name: 'Hala' }]);
      await q('insert into files (id, doc, project_id) values (?, ?, ?)', ['fil_001', { id: 'fil_001', name: 'Plan' }, 'prj_001']);
      await q('insert into feedback (id, doc) values (?, ?)', ['fbk_001', { id: 'fbk_001', message: 'Hi' }]);
    });
    expect([...(await readUsers(db, ['usr_001', 'usr_404'])).keys()]).toEqual(['usr_001']);
    expect(await readFile(db, 'fil_001')).toMatchObject({ id: 'fil_001' });
    expect(await readFeedback(db, 'fbk_001')).toMatchObject({ id: 'fbk_001' });
  });

  it('finds the stored keys that a file version or a screenshot still uses, and the keys of a project', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await q('insert into files (id, doc, project_id) values (?, ?, ?)', ['fil_001', { id: 'fil_001', versions: [{ blobKey: 'k/a', thumbKey: 'k/a.t' }, 'loose'] }, 'prj_001']);
      await q('insert into feedback (id, doc) values (?, ?)', ['fbk_001', { id: 'fbk_001', screenshots: [{ blobKey: 'k/s' }] }]);
      await q('insert into events (id, doc, seq, project_id, target_type) values (?, ?, ?, ?, ?)', ['evt_001', { id: 'evt_001', before: { versions: [{ blobKey: 'k/old' }] }, after: null }, 1, 'prj_001', 'file']);
    });
    expect(await blobKeysInUse(db, ['k/a', 'k/a.t', 'k/s', 'k/gone'])).toEqual(new Set(['k/a', 'k/a.t', 'k/s']));
    expect((await db.tx('read', (q) => projectBlobKeys(q, 'prj_001'))).sort()).toEqual(['k/a', 'k/a.t', 'k/old']);
  });

  it('reads no key, and no error, from a versions field that is text and not a list, as Postgres does', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await q('insert into files (id, doc, project_id) values (?, ?, ?)', ['fil_001', { id: 'fil_001', versions: 'loose' }, 'prj_001']);
      await q('insert into events (id, doc, seq, project_id, target_type) values (?, ?, ?, ?, ?)', ['evt_001', { id: 'evt_001', before: { versions: 'old' }, after: { versions: 7 } }, 1, 'prj_001', 'file']);
    });
    expect(await db.tx('read', (q) => projectBlobKeys(q, 'prj_001'))).toEqual([]);
  });

  it('tells whether the last user.updated event of a person changed the email', async () => {
    const { db } = await freshLite();
    await db.tx('write', async (q) => {
      await q('insert into events (id, doc, seq, target_type, target_id, verb) values (?, ?, ?, ?, ?, ?)', ['evt_001', { after: { email: 'a@b.c' }, actingForId: 'usr_001' }, 1, 'user', 'usr_002', 'user.updated']);
      await q('insert into events (id, doc, seq, target_type, target_id, verb) values (?, ?, ?, ?, ?, ?)', ['evt_002', { after: { name: 'B' }, actingForId: 'usr_001' }, 2, 'user', 'usr_003', 'user.updated']);
    });
    expect(await db.statement('read', USER_EMAIL_CHANGED_LITE, ['usr_002'])).toEqual([{ changed: 1, actor: 'usr_001' }]);
    expect(await db.statement('read', USER_EMAIL_CHANGED_LITE, ['usr_003'])).toEqual([{ changed: 0, actor: 'usr_001' }]);
  });
});
