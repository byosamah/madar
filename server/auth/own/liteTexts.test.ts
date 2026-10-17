import { describe, expect, it } from 'vitest';
import { writeOutbox } from '../../core/effects';
import { isLite, statementQuery } from '../../data/dialect';
import { readLiteOffice } from '../../data/lite/office';
import { freshLite } from '../../data/lite/testDb';
import { userIdOfAuth } from '../../data/officeCache';
import { release, reserve, sendCounted } from '../../mail/quota';
import { fakeDeps } from '../../test/fakes/deps';
import { LATER_INVITE_LITE, NEWER_LINK_LITE, sqlInviteStore } from '../invite';
import { hitLimit } from '../rateLimit';
import { addSignIn, signinOffice } from './testOffice';

const NOW = new Date('2026-10-17T06:10:00Z');
const invite = (userId: string, inviteId: string, more: Record<string, unknown> = {}) => ({ kind: 'auth.invite', payload: { userId, inviteId, ...more } });

describe('the SQLite forms of the sign-in texts of today (Supabase exit, wave 2)', () => {
  it('counts a limit in one statement and gives the new count', async () => {
    const { db } = await freshLite();
    const hit = () => db.tx('write', (q) => hitLimit(q, { key: 'k', limit: 2, windowMs: 3_600_000, now: NOW }));
    expect((await hit()).count).toBe(1);
    expect((await hit()).ok).toBe(true);
    expect(await hit()).toEqual({ ok: false, count: 3, retryAfterMs: 50 * 60_000 });
  });

  it('keeps the dialect of the Db in a statement query', async () => {
    const { db } = await freshLite();
    expect(isLite(statementQuery(db, 'write'))).toBe(true);
  });

  it('reserves one place a day for each ref, stops at 98, and gives a place back', async () => {
    const { db } = await freshLite();
    const place = (ref: string) => db.tx('write', (q) => reserve(q, 'signin', ref, { now: NOW, userId: 'usr_002' }));
    for (let i = 0; i < 98; i += 1) expect(await place(`r${i}`)).toBe('ok');
    expect(await place('r0')).toBe('ok');
    expect(await place('r98')).toBe('over');
    await release(statementQuery(db, 'write'), 'r5');
    expect(await place('r98')).toBe('ok');
  });

  it('sends a counted sign-in mail and records its mail id', async () => {
    const { raw, db } = await freshLite();
    const deps = fakeDeps({ db });
    deps.clock.set(NOW);
    const sent = await sendCounted(deps, 'signin', { to: 'p@madar.test', subject: 's', html: 'h', text: 't', tag: 'invite', idempotencyKey: 'invite:inv_1' }, { userId: 'usr_002' });
    expect(sent).toEqual({ status: 'sent', id: 'mail_1' });
    expect(raw.prepare('select utc_day, kind, ref, resend_id from mail_log').all()).toEqual([{ utc_day: '2026-10-17', kind: 'signin', ref: 'invite:inv_1', resend_id: 'mail_1' }]);
  });

  it('keeps the notes, the renew key once and the sent mark in the outbox payload', async () => {
    const { raw, db } = await freshLite();
    const [id] = await db.tx('write', (q) => writeOutbox(q, [invite('usr_002', 'inv_a')]));
    const store = sqlInviteStore({ db, config: fakeDeps().config });
    await store.note('inv_a', { owesInvite: true, tokenHash: 'T', authUserId: 'A', linkType: 'invite' });
    await store.keepRenewKey('inv_a', 'key1', 'renew:h1');
    await store.keepRenewKey('inv_a', 'key1', 'renew:h1');
    await store.markSent('inv_a', NOW, 'mail_1');
    const { payload } = raw.prepare('select payload from outbox where id = ?').get(Number(id)) as { payload: string };
    expect(JSON.parse(payload)).toEqual({ userId: 'usr_002', inviteId: 'inv_a', owesInvite: true, authUserId: 'A', linkType: 'invite', renewKeys: ['renew:h1'], sentAt: NOW.toISOString(), mailId: 'mail_1' });
  });

  it('finds a newer link and a later invitation of the same person, and none of another person', async () => {
    const { db } = await freshLite();
    await db.tx('write', (q) => writeOutbox(q, [invite('usr_002', 'inv_a'), invite('usr_002', 'inv_b', { linkType: 'invite' }), invite('usr_003', 'inv_c', { linkType: 'invite' })]));
    const store = sqlInviteStore({ db, config: fakeDeps().config });
    expect(await store.newerLink('usr_002', 'inv_a')).toBe(true);
    expect(await store.newerLink('usr_002', 'inv_b')).toBe(false);
    expect(await store.laterInvite('usr_002', 'inv_a')).toBe(true);
    // usr_004 has no row: the later rows of usr_002 and usr_003 do not count for that person.
    expect(await store.laterInvite('usr_004', 'inv_a')).toBe(false);
    expect(await store.newerLink('usr_004', 'inv_a')).toBe(false);
    expect(await store.laterInvite('usr_003', 'inv_c')).toBe(false);
  });

  it('reads each invitation text through the outbox_signin index', async () => {
    const { raw } = await freshLite();
    for (const text of [NEWER_LINK_LITE, LATER_INVITE_LITE]) {
      const plan = (raw.prepare(`explain query plan ${text}`).all('usr_002', 'inv_a') as { detail: string }[]).map((row) => row.detail).join(' | ');
      expect(plan).toContain('USING INDEX outbox_signin');
      expect(plan).not.toContain('SCAN outbox');
    }
  });

  it('reads the person with the sign-in link, and keeps a new link in one transaction with the payload', async () => {
    const t = await signinOffice();
    const authId = await addSignIn(t, 'usr_002');
    const store = sqlInviteStore(t.deps);
    expect((await store.person('usr_002'))?.authUserId).toBe(authId);
    expect((await store.person('usr_003'))?.authUserId).toBeNull();
    await t.db.tx('write', (q) => writeOutbox(q, [invite('usr_003', 'inv_d')]));
    const link = await t.deps.authAdmin.generateLink('invite', (await store.person('usr_003'))!.user.email);
    await store.keepLink('inv_d', 'usr_003', { type: 'invite', ...link }, true);
    const office = await t.db.tx('read', (q) => readLiteOffice(t.db, q));
    expect(userIdOfAuth(office, link.authUserId)).toBe('usr_003');
  });
});
