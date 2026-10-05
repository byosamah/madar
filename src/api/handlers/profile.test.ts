import { beforeEach, describe, expect, it } from 'vitest';
import { User, UserAvatarInput } from '../contract/entities';
import { UserCard } from '../contract/views';
import { cardOf, eventLabel, userCard } from '../views';
import { peopleCalls } from './people';
import { insightCalls } from './insights';
import { taskCalls } from './tasks';
import { historyCalls } from './history';
import { stageTemplateCalls } from './stageTemplates';
import { taskTemplateCalls } from './taskTemplates';
import { trackerCalls } from './tracker';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/** A small WebP picture as the browser saves it: a data address with base64 data. */
const PICTURE = `data:image/webp;base64,${'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'.repeat(10)}`;

describe('the profile picture in the contract (owner item 10, 2026-10-05)', () => {
  it('saves my own picture as a data address and takes it off again', async () => {
    const t = testApi(peopleCalls);
    const saved = await t.api.call('me.updateProfile', { avatarUrl: PICTURE });
    expect(saved.avatarUrl).toBe(PICTURE);
    expect(t.store.state.users.usr_001.avatarUrl).toBe(PICTURE);
    const removed = await t.api.call('me.updateProfile', { avatarUrl: null });
    expect(removed.avatarUrl).toBeNull();
  });

  it('accepts WebP, JPEG and PNG data, and an https address', () => {
    for (const type of ['webp', 'jpeg', 'png']) expect(UserAvatarInput.safeParse(`data:image/${type};base64,AAAA`).success).toBe(true);
    expect(UserAvatarInput.safeParse('https://example.com/me.png').success).toBe(true);
    expect(UserAvatarInput.safeParse(null).success).toBe(true);
  });

  it('refuses every other value: other schemes, other data types, bad data and values that are too long', async () => {
    const bad = [
      'javascript:alert(1)', 'http://example.com/me.png', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/webp,notbase64', 'data:image/webp;base64,<script>', '/avatars/me.png', '',
      `data:image/webp;base64,${'A'.repeat(24_000)}`, `https://example.com/${'a'.repeat(2_000)}`,
    ];
    for (const value of bad) expect(UserAvatarInput.safeParse(value).success, value.slice(0, 40)).toBe(false);
    const t = testApi(peopleCalls);
    await expect(t.api.call('me.updateProfile', { avatarUrl: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { avatarUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(t.store.state.users.usr_001.avatarUrl).toBeNull();
  });

  it('lets the people manager set a picture through users.update with the same rule', async () => {
    const t = testApi(peopleCalls);
    const saved = await t.api.call('users.update', { id: 'usr_003', patch: { avatarUrl: PICTURE } });
    expect(saved.avatarUrl).toBe(PICTURE);
  });

  it('still reads a saved person with an old picture value or none', () => {
    const old = { ...makeUser('usr_009'), avatarUrl: 'https://cdn.example.com/a.png' };
    expect(User.safeParse(old).success).toBe(true);
    expect(User.safeParse({ ...old, avatarUrl: '/legacy/a.png' }).success).toBe(true);
    expect(User.safeParse({ ...old, avatarUrl: PICTURE }).success).toBe(true);
    expect(User.safeParse({ ...old, avatarUrl: `data:image/webp;base64,${'A'.repeat(24_000)}` }).success).toBe(false);
    // A long value that is not picture data was never possible, and stays refused.
    expect(User.safeParse({ ...old, avatarUrl: `https://x.example/${'a'.repeat(2_000)}` }).success).toBe(false);
  });

  it('keeps picture data out of the person card, so lists stay small, and keeps an https picture', () => {
    const t = testApi(peopleCalls);
    t.store.state.users.usr_002.avatarUrl = PICTURE;
    t.store.state.users.usr_003.avatarUrl = 'https://example.com/sara.png';
    expect(userCard(t.store.state.users.usr_002).avatarUrl).toBeNull();
    expect(userCard(t.store.state.users.usr_003).avatarUrl).toBe('https://example.com/sara.png');
  });
});

describe('the names in two languages in the contract (owner item 12, 2026-10-05)', () => {
  it('creates a person with an English and an Arabic name', async () => {
    const t = testApi(peopleCalls);
    const made = await t.api.call('users.create', { name: 'Nora Saleh', nameAr: 'نورة صالح', email: 'nora@madar.test', discipline: 'Interior' });
    expect(made).toMatchObject({ name: 'Nora Saleh', nameAr: 'نورة صالح' });
    expect(t.store.state.users[made.id].nameAr).toBe('نورة صالح');
  });

  it('still creates a person with the English name only, for old callers', async () => {
    const t = testApi(peopleCalls);
    const made = await t.api.call('users.create', { name: 'Old Caller', email: 'old@madar.test', discipline: 'MEP' });
    expect(made.nameAr).toBeUndefined();
  });

  it('refuses an Arabic name that is empty or over 80 characters on create', async () => {
    const t = testApi(peopleCalls);
    await expect(t.api.call('users.create', { name: 'X', nameAr: ' ', email: 'x@madar.test', discipline: 'MEP' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('users.create', { name: 'X', nameAr: 'ن'.repeat(81), email: 'x@madar.test', discipline: 'MEP' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('changes and clears the Arabic name through users.update and me.updateProfile', async () => {
    const t = testApi(peopleCalls);
    expect((await t.api.call('users.update', { id: 'usr_003', patch: { nameAr: 'سارة' } })).nameAr).toBe('سارة');
    expect((await t.api.call('users.update', { id: 'usr_003', patch: { nameAr: '' } })).nameAr).toBe('');
    const mine = await t.api.call('me.updateProfile', { name: 'Hala Nasser', nameAr: 'هالة ناصر' });
    expect(mine).toMatchObject({ name: 'Hala Nasser', nameAr: 'هالة ناصر' });
  });

  it('reads a saved person with no Arabic name', () => {
    const old = makeUser('usr_009');
    expect(User.safeParse(old).success).toBe(true);
    expect(User.safeParse({ ...old, nameAr: 'ن'.repeat(81) }).success).toBe(false);
  });

  it('puts the Arabic name in the person card', () => {
    const t = testApi(peopleCalls);
    t.store.state.users.usr_002.nameAr = 'فيصل';
    expect(userCard(t.store.state.users.usr_002).nameAr).toBe('فيصل');
    expect(cardOf(t.store.state, 'usr_002').nameAr).toBe('فيصل');
    expect('nameAr' in userCard(t.store.state.users.usr_003)).toBe(false);
    expect(UserCard.safeParse({ id: 'usr_001', name: 'A', avatarUrl: null, kind: 'human', discipline: '' }).success).toBe(true);
  });

  it('finds a person by the Arabic name in search', async () => {
    const t = testApi({ ...peopleCalls, ...insightCalls });
    t.store.state.users.usr_003.nameAr = 'سارة القحطاني';
    const found = await t.api.call('search.query', { text: 'القحطاني' });
    expect(found.people.map((p) => p.id)).toEqual(['usr_003']);
    expect(found.people[0].nameAr).toBe('سارة القحطاني');
  });

  it('gives the Preview as list the Arabic name of the person an agent acts for', async () => {
    const t = testApi(peopleCalls);
    t.store.state.users.usr_003.nameAr = 'سارة';
    const session = await t.api.call('session.get', {});
    expect(session.previewUsers.find((u) => u.id === 'usr_005')).toMatchObject({ actingForName: 'Sara Team', actingForNameAr: 'سارة' });
  });

  it('writes both names of a person into the event details that name one', async () => {
    const t = testApi({ ...peopleCalls, ...taskCalls, ...historyCalls });
    const state = t.store.state;
    state.users.usr_003.nameAr = 'سارة';
    state.tasks.tsk_001 = makeTask({ ownerId: 'usr_002' });
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_003' } });
    const event = Object.values(state.events).find((e) => e.targetId === 'tsk_001' && (e.after as { ownerId?: string } | null)?.ownerId === 'usr_003');
    expect(event).toBeDefined();
    expect(eventLabel(state, event!).detail).toMatchObject({ lead: 'Sara Team', leadAr: 'سارة' });
    const member = { ...event!, targetType: 'member' as const, targetId: 'prj_001:usr_003', after: {}, before: null };
    expect(eventLabel(state, member)).toEqual({ label: 'Sara Team', detail: { labelAr: 'سارة' } });
  });
});
