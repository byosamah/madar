import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeFilesDb } from '../files/fakeFilesDb';
import { insertIntents, type Intent } from '../files/intents';
import { fakeDeps } from '../test/fakes/deps';
import { feedbackScreenshotHooks, feedbackSendHooks, feedbackUploadStart } from './feedback';

/** feedback.uploadStart and the server hooks of feedback.send and feedback.screenshot (plan 5.2; plan 2b, point 7; task F2). */

const NOW = new Date('2026-10-04T06:00:00Z');

const user = (id: string, o: Partial<User> = {}): User =>
  ({ id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null, ...o }) as User;

const USERS: Record<string, User> = {
  usr_001: user('usr_001', { systemRole: 'admin' }),
  usr_002: user('usr_002'),
  usr_003: user('usr_003', { active: false }),
  usr_009: user('usr_009', { kind: 'agent', ownerId: 'usr_001' }),
  usr_010: user('usr_010', { kind: 'agent', ownerId: 'usr_003' }),
};

const office = snapshotOf({
  users: USERS, teams: {}, settings: {} as never, clients: {}, stageTemplates: {}, taskTemplates: {}, projects: {}, members: {}, stages: {}, deadlines: {}, conversations: {},
}, 1);

function setup() {
  const db = fakeFilesDb({
    users: USERS,
    feedback: { fbk_001: { id: 'fbk_001', screenshots: [{ blobKey: 'feedback/upl-s/file', type: 'image/png' }] } },
  });
  const deps = fakeDeps({ db });
  deps.clock.set(NOW);
  const ctx = (userId: string): ServerCallCtx => ({
    deps, principal: USERS[userId]?.kind === 'agent' ? { userId, agent: { clientId: 'cli-1' } } : { userId }, office, batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW,
  });
  const hook = (actorId: string) => ({ actorId, now: NOW, deps });
  return { db, deps, ctx, hook };
}

const shotIntent = (id: string, o: Partial<Intent> = {}): Intent => ({
  id, actorId: 'usr_002', projectId: null, stagingKey: `up/${id.replace('_', '-')}/file`, key: `feedback/${id.replace('_', '-')}/file`, thumbKey: null,
  size: 50, mimeType: 'image/png', expiresAt: new Date('2026-10-04T08:00:00Z'), usedAt: null, ...o,
});

describe('feedback.uploadStart', () => {
  it('signs one PUT for each screenshot and writes one intent each, with the screenshot key and no project', async () => {
    const { db, ctx } = setup();
    const { output } = await feedbackUploadStart({ screenshots: [{ size: 50, mimeType: 'image/png' }, { size: 60, mimeType: 'image/jpeg' }] }, ctx('usr_002'));
    expect(output.uploads).toHaveLength(2);
    for (const upload of output.uploads) {
      const part = upload.uploadId.replace('_', '-');
      expect(upload.put.url).toBe(`https://files.test/put/up/${part}/file`);
      expect(db.intents.get(upload.uploadId)).toMatchObject({ projectId: null, key: `feedback/${part}/file`, actorId: 'usr_002', expiresAt: new Date('2026-10-04T08:00:00Z') });
    }
  });

  it('refuses an inactive person and an agent whose person is off before it signs or writes anything', async () => {
    for (const userId of ['usr_003', 'usr_010']) {
      const { db, deps, ctx } = setup();
      await expect(feedbackUploadStart({ screenshots: [{ size: 50, mimeType: 'image/png' }] }, ctx(userId))).rejects.toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
      expect([deps.files.calls, db.intents.size]).toEqual([[], 0]);
    }
  });

  it('refuses a picture type longer than a report keeps (60 characters)', async () => {
    const { ctx } = setup();
    await expect(feedbackUploadStart({ screenshots: [{ size: 50, mimeType: `image/${'x'.repeat(60)}` }] }, ctx('usr_002'))).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('the server hooks of feedback.send', () => {
  const SEND = { kind: 'bug', message: 'It broke', page: '', uploadIds: ['upl_a', 'upl_b'] };

  it('with no uploads, do no work at all', async () => {
    const { db, deps, hook } = setup();
    expect(await feedbackSendHooks.preflight!({ ...SEND, uploadIds: [] }, hook('usr_002'))).toEqual({ shots: [] });
    expect(await feedbackSendHooks.prepare!({ ...SEND, uploadIds: [] }, { ...hook('usr_002'), q: db.q }, { shots: [] })).toEqual({ shots: [] });
    expect([db.statements, deps.files.calls]).toEqual([[], []]);
  });

  it('check and copy each screenshot to its key, in the order sent, and mark the intents used inside the lock', async () => {
    const { db, deps, hook } = setup();
    await insertIntents(db, [shotIntent('upl_a'), shotIntent('upl_b', { mimeType: 'image/jpeg', size: 70 })]);
    deps.files.objects.set('up/upl-a/file', { size: 50, mimeType: 'image/png' });
    deps.files.objects.set('up/upl-b/file', { size: 70, mimeType: 'image/jpeg' });
    const shots = await feedbackSendHooks.preflight!(SEND, hook('usr_002'));
    expect(shots).toEqual({ shots: [{ blobKey: 'feedback/upl-a/file', type: 'image/png' }, { blobKey: 'feedback/upl-b/file', type: 'image/jpeg' }] });
    expect([...deps.files.objects.keys()].sort()).toEqual(['feedback/upl-a/file', 'feedback/upl-b/file']);
    expect(await feedbackSendHooks.prepare!(SEND, { ...hook('usr_002'), q: db.q }, shots)).toEqual(shots);
    await expect(feedbackSendHooks.prepare!(SEND, { ...hook('usr_002'), q: db.q }, shots)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuse a file intent, an upload sent twice, and a picture that differs from its intent', async () => {
    const { db, deps, hook } = setup();
    await insertIntents(db, [shotIntent('upl_a'), shotIntent('upl_f', { projectId: 'prj_001', key: 'prj-001/upl-f/file' })]);
    await expect(feedbackSendHooks.preflight!({ ...SEND, uploadIds: ['upl_f'] }, hook('usr_002'))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(feedbackSendHooks.preflight!({ ...SEND, uploadIds: ['upl_a', 'upl_a'] }, hook('usr_002'))).rejects.toMatchObject({ code: 'invalid_input' });
    deps.files.objects.set('up/upl-a/file', { size: 50, mimeType: 'application/octet-stream' });
    await expect(feedbackSendHooks.preflight!({ ...SEND, uploadIds: ['upl_a'] }, hook('usr_002'))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(deps.files.objects.size).toBe(0);
  });
});

describe('the link hook of feedback.screenshot', () => {
  it('signs an inline link to the screenshot for the Admin, and for an agent of the Admin', async () => {
    for (const actorId of ['usr_001', 'usr_009']) {
      const { deps, hook } = setup();
      expect(await feedbackScreenshotHooks.preflight!({ id: 'fbk_001', index: 0 }, hook(actorId))).toEqual({
        link: { url: 'https://files.test/get/feedback/upl-s/file?disposition=inline', expiresAt: '2099-01-01T00:00:00.000Z' },
      });
      expect(deps.files.calls).toEqual([{ op: 'presignGet', key: 'feedback/upl-s/file' }]);
    }
  });

  it('refuses a person who is not the Admin, an inactive person and an agent whose person is off, before it signs', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['usr_002', { code: 'forbidden', details: { action: 'admin.manage' } }],
      ['usr_003', { code: 'unauthenticated', details: { reason: 'account_off' } }],
      ['usr_010', { code: 'unauthenticated', details: { reason: 'account_off' } }],
    ];
    for (const [actorId, error] of cases) {
      const { deps, hook } = setup();
      await expect(feedbackScreenshotHooks.preflight!({ id: 'fbk_001', index: 0 }, hook(actorId))).rejects.toMatchObject(error);
      expect(deps.files.calls).toEqual([]);
    }
  });

  it('refuses a missing report and a missing screenshot', async () => {
    const { hook } = setup();
    await expect(feedbackScreenshotHooks.preflight!({ id: 'fbk_404', index: 0 }, hook('usr_001'))).rejects.toMatchObject({ code: 'not_found' });
    await expect(feedbackScreenshotHooks.preflight!({ id: 'fbk_001', index: 2 }, hook('usr_001'))).rejects.toMatchObject({ code: 'not_found' });
  });
});
