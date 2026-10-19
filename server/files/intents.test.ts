import { describe, expect, it } from 'vitest';
import { fakeFilesDb } from './fakeFilesDb';
import { checkIntent, insertIntents, intentExpiry, intentOf, newUploadId, readIntents, useIntents, type Intent } from './intents';
import { stagingKey } from './keys';

/** The upload intents (plan 5.2; proof.md, Z0a item 6; task F2). */

const NOW = new Date('2026-10-04T06:00:00Z');

const intent = (o: Partial<Intent> = {}): Intent => ({
  id: 'upl_aaaaaaaaaaaaaaaaaaaaaa', actorId: 'usr_002', projectId: 'prj_001', stagingKey: 'up/upl-aaaaaaaaaaaaaaaaaaaaaa/file',
  key: 'prj-001/upl-aaaaaaaaaaaaaaaaaaaaaa/file', thumbKey: null, size: 12, mimeType: 'application/pdf',
  expiresAt: new Date(NOW.getTime() + 7_200_000), usedAt: null, ...o,
});

const codeOf = (work: () => unknown) => {
  try {
    work();
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe('an upload intent', () => {
  it('gets an id of "upl_" and 22 random base32 characters, which makes a valid key', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newUploadId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^upl_[a-z2-7]{22}$/);
      expect(stagingKey(id)).toMatch(/^up\/upl-[a-z2-7]{22}\/file$/);
    }
  });

  it('lives for the link life on Storage (2 hours) and for the link plus 60 minutes on R2', () => {
    expect(intentExpiry(NOW, 'supabase').toISOString()).toBe('2026-10-04T08:00:00.000Z');
    expect(intentExpiry(NOW, 'r2').toISOString()).toBe('2026-10-04T07:10:00.000Z');
  });

  it('reads a row with a bigint size and timestamps as text or Date', () => {
    const row = {
      id: 'upl_x', actor_id: 'usr_002', project_id: null, staging_key: 'up/upl-x/file', key: 'feedback/upl-x/file', thumb_key: null,
      size: '42', mime_type: 'image/png', expires_at: '2026-10-04T08:00:00Z', used_at: new Date('2026-10-04T07:00:00Z'),
    };
    expect(intentOf(row)).toEqual({
      id: 'upl_x', actorId: 'usr_002', projectId: null, stagingKey: 'up/upl-x/file', key: 'feedback/upl-x/file', thumbKey: null,
      size: 42, mimeType: 'image/png', expiresAt: new Date('2026-10-04T08:00:00Z'), usedAt: new Date('2026-10-04T07:00:00Z'),
    });
  });

  it('is written and read back by id', async () => {
    const db = fakeFilesDb();
    await insertIntents(db, [intent(), intent({ id: 'upl_b', thumbKey: 'prj-001/upl-b/thumb' })]);
    const found = await readIntents(db, ['upl_b', 'upl_404']);
    expect([...found.keys()]).toEqual(['upl_b']);
    expect(found.get('upl_b')).toMatchObject({ thumbKey: 'prj-001/upl-b/thumb', size: 12 });
  });

  it('passes the check only for its own actor, its own project or feedback, unused and before expires_at', () => {
    const file = { id: 'upl_aaaaaaaaaaaaaaaaaaaaaa', actorId: 'usr_002', now: NOW, field: 'uploadId', projectId: 'prj_001' as string | null };
    expect(codeOf(() => checkIntent(intent(), file))).toBe('ok');
    expect(codeOf(() => checkIntent(undefined, file))).toBe('not_found');
    expect(codeOf(() => checkIntent(intent({ actorId: 'usr_005' }), file))).toBe('not_found');
    expect(codeOf(() => checkIntent(intent({ projectId: 'prj_002' }), file))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ projectId: null, key: 'feedback/upl-a/file' }), file))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ projectId: null, key: 'feedback/upl-a/file' }), { ...file, projectId: null }))).toBe('ok');
    expect(codeOf(() => checkIntent(intent(), { ...file, projectId: null }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ usedAt: NOW }), file))).toBe('conflict');
    expect(codeOf(() => checkIntent(intent({ expiresAt: NOW }), file))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ expiresAt: new Date(NOW.getTime() - 1) }), file))).toBe('invalid_input');
  });

  it('with allowUsed, lets a used intent of the same actor pass, for the replay of a stored answer, and keeps every other check', () => {
    const file = { id: 'upl_aaaaaaaaaaaaaaaaaaaaaa', actorId: 'usr_002', now: NOW, field: 'uploadId', projectId: 'prj_001' as string | null, allowUsed: true };
    expect(codeOf(() => checkIntent(intent({ usedAt: NOW }), file))).toBe('ok');
    expect(codeOf(() => checkIntent(intent({ usedAt: NOW, projectId: null, key: 'feedback/upl-a/file' }), { ...file, projectId: null }))).toBe('ok');
    expect(codeOf(() => checkIntent(intent({ usedAt: NOW, actorId: 'usr_005' }), file))).toBe('not_found');
    expect(codeOf(() => checkIntent(intent({ usedAt: NOW, projectId: 'prj_002' }), file))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ usedAt: NOW }), { ...file, projectId: null }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ usedAt: NOW, expiresAt: NOW }), file))).toBe('invalid_input');
  });

  it('passes a chat intent only for the chat that the call names, with no project (owner, 2026-10-19)', () => {
    const chat = intent({ projectId: null, key: 'chat/cnv-001/upl-aaaaaaaaaaaaaaaaaaaaaa/file' });
    const call = { id: 'upl_aaaaaaaaaaaaaaaaaaaaaa', actorId: 'usr_002', now: NOW, field: 'uploadId', projectId: null as string | null, conversationId: 'cnv_001' };
    expect(codeOf(() => checkIntent(chat, call))).toBe('ok');
    expect(codeOf(() => checkIntent(chat, { ...call, conversationId: 'cnv_002' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(chat, { ...call, conversationId: 'cnv_0010' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(chat, { ...call, conversationId: undefined }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(chat, { ...call, conversationId: undefined, officeTaskId: 'tsk_001' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(chat, { ...call, conversationId: undefined, projectId: 'prj_001' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(chat, { ...call, projectId: 'prj_001' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ projectId: 'prj_001' }), call))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ projectId: null, key: 'office/tsk-001/upl-a/file' }), call))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ projectId: null, key: 'feedback/upl-a/file' }), call))).toBe('invalid_input');
    expect(codeOf(() => checkIntent({ ...chat, usedAt: NOW }, { ...call, allowUsed: true }))).toBe('ok');
    expect(codeOf(() => checkIntent({ ...chat, usedAt: NOW }, call))).toBe('conflict');
  });

  it('passes a meeting intent only for the meeting that the call names, with no project (wave 2)', () => {
    const meeting = intent({ projectId: null, key: 'meeting/mtg-001/upl-aaaaaaaaaaaaaaaaaaaaaa/file' });
    const call = { id: 'upl_aaaaaaaaaaaaaaaaaaaaaa', actorId: 'usr_002', now: NOW, field: 'uploadId', projectId: null as string | null, meetingId: 'mtg_001' };
    expect(codeOf(() => checkIntent(meeting, call))).toBe('ok');
    expect(codeOf(() => checkIntent(meeting, { ...call, meetingId: 'mtg_002' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(meeting, { ...call, meetingId: 'mtg_0010' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(meeting, { ...call, meetingId: undefined }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(meeting, { ...call, meetingId: undefined, conversationId: 'cnv_001' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(meeting, { ...call, meetingId: undefined, officeTaskId: 'tsk_001' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(meeting, { ...call, projectId: 'prj_001' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(meeting, { ...call, conversationId: 'cnv_001' }))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ projectId: 'prj_001' }), call))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ projectId: null, key: 'chat/cnv-001/upl-a/file' }), call))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ projectId: null, key: 'office/tsk-001/upl-a/file' }), call))).toBe('invalid_input');
    expect(codeOf(() => checkIntent(intent({ projectId: null, key: 'feedback/upl-a/file' }), call))).toBe('invalid_input');
    expect(codeOf(() => checkIntent({ ...meeting, usedAt: NOW }, { ...call, allowUsed: true }))).toBe('ok');
    expect(codeOf(() => checkIntent({ ...meeting, usedAt: NOW }, call))).toBe('conflict');
  });

  it('is marked used once, inside the lock: a second use, an expired intent or another actor gives conflict', async () => {
    const db = fakeFilesDb();
    await insertIntents(db, [intent(), intent({ id: 'upl_old', expiresAt: NOW }), intent({ id: 'upl_other', actorId: 'usr_005' })]);
    await useIntents(db.q, ['upl_aaaaaaaaaaaaaaaaaaaaaa'], 'usr_002', NOW);
    expect(db.intents.get('upl_aaaaaaaaaaaaaaaaaaaaaa')?.usedAt).toEqual(NOW);
    await expect(useIntents(db.q, ['upl_aaaaaaaaaaaaaaaaaaaaaa'], 'usr_002', NOW)).rejects.toMatchObject({ code: 'conflict' });
    await expect(useIntents(db.q, ['upl_old'], 'usr_002', NOW)).rejects.toMatchObject({ code: 'conflict' });
    await expect(useIntents(db.q, ['upl_other'], 'usr_002', NOW)).rejects.toMatchObject({ code: 'conflict' });
    await expect(useIntents(db.q, [], 'usr_002', NOW)).resolves.toBeUndefined();
  });
});
