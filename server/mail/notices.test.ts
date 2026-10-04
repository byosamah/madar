import { afterEach, describe, expect, it } from 'vitest';
import { defaultPreferences, type Preferences } from '../../src/api/contract/entities';
import { sharedCalls } from '../../src/api/sharedCalls';
import { EFFECTS_OF, registerEffect } from '../core/effects';
import { fakeDeps } from '../test/fakes/deps';
import { memoryMailDb } from './memoryMailDb';
import {
  ADMINS_SQL, NEW_NOTICES_SQL, NOTICE_EFFECT, NOTICE_FREE_CALLS, NOTICE_MAIL_SQL, QUOTA_WARNING_EFFECT, USER_MAIL_SQL,
  appLink, noticeRows, sendNoticeMail, sendQuotaWarning,
} from './notices';
import { registerMailEffects } from './register';

/**
 * The notice mail (plan 5.4; task N2.2): which new notices get an email, the mail itself, and the one Admin warning of a day.
 * The SQL runs on the local database in server/it/email.it.test.ts; here a small database in memory answers it.
 */

const DAY = '2026-10-04';
const NOW = new Date(`${DAY}T06:00:00Z`);

type Person = { id: string; kind: 'human' | 'agent'; active: boolean; email: string; preferences: Preferences; gender: string | null };
const person = (id: string, more: Partial<Person> = {}): Person => ({
  id, kind: 'human', active: true, email: `${id}@madar.test`, preferences: defaultPreferences(), gender: null, ...more,
});
const withPrefs = (change: (p: Preferences) => void) => {
  const p = defaultPreferences();
  change(p);
  return p;
};

function setup(o: { people?: Person[]; notices?: { id: string; userId: string; trigger: string }[] } = {}) {
  const people = new Map((o.people ?? [person('usr_002')]).map((p) => [p.id, p]));
  const notices = o.notices ?? [{ id: 'ntf_1', userId: 'usr_002', trigger: 'task_assigned' }];
  const mem = memoryMailDb((text, values) => {
    if (text === NOTICE_MAIL_SQL) {
      const n = notices.find((x) => x.id === values[0]);
      const p = n && people.get(n.userId);
      return n && p ? [{ id: n.id, trigger: n.trigger, user_id: p.id, kind: p.kind, active: p.active, email: p.email, preferences: p.preferences, gender: p.gender }] : [];
    }
    if (text === USER_MAIL_SQL) {
      const p = people.get(values[0] as string);
      return p ? [{ user_id: p.id, kind: p.kind, active: p.active, email: p.email, preferences: p.preferences, gender: p.gender }] : [];
    }
    if (text === ADMINS_SQL) return [{ id: 'usr_001' }, { id: 'usr_005' }];
    return undefined;
  });
  const deps = fakeDeps({ db: mem.db, config: { appUrl: 'https://madar.test/' } });
  deps.clock.set(NOW);
  return { mem, deps, people };
}

describe('noticeRows: the new notices that get an email', () => {
  it('asks nothing when the save wrote no notice', async () => {
    const { mem } = setup();
    expect(await noticeRows(mem.q, { kinds: new Set(['tasks']), people: new Set(['usr_002']) })).toEqual([]);
    expect(await noticeRows(mem.q, { kinds: new Set(['notifications']), people: new Set() })).toEqual([]);
    expect(mem.statements).toEqual([]);
  });

  it('keeps an active person whose email switch of the trigger is on, by choice or by default', async () => {
    const rows = [
      { id: 'ntf_1', user_id: 'usr_002', trigger: 'task_assigned', kind: 'human', active: true, preferences: defaultPreferences() },
      { id: 'ntf_2', user_id: 'usr_003', trigger: 'overdue', kind: 'human', active: true, preferences: defaultPreferences() },
      { id: 'ntf_3', user_id: 'usr_004', trigger: 'overdue', kind: 'human', active: true, preferences: withPrefs((p) => { p.email = { overdue: true }; }) },
      { id: 'ntf_4', user_id: 'usr_005', trigger: 'mention', kind: 'human', active: true, preferences: withPrefs((p) => { p.email = { mention: false }; }) },
      { id: 'ntf_5', user_id: 'usr_006', trigger: 'mention', kind: 'human', active: false, preferences: defaultPreferences() },
      { id: 'ntf_6', user_id: 'usr_009', trigger: 'mention', kind: 'agent', active: true, preferences: defaultPreferences() },
      { id: 'ntf_7', user_id: 'usr_007', trigger: 'mention', kind: 'human', active: true, preferences: withPrefs((p) => { p.notifications.mention = false; }) },
    ];
    const seen: unknown[][] = [];
    const q = (async (text: string, values: unknown[]) => {
      expect(text).toBe(NEW_NOTICES_SQL);
      seen.push(values);
      return rows;
    }) as never;
    const out = await noticeRows(q, { kinds: new Set(['notifications', 'tasks']), people: new Set(['usr_003', 'usr_002']) });
    expect(out).toEqual([
      { kind: NOTICE_EFFECT, payload: { notificationId: 'ntf_1' } },
      { kind: NOTICE_EFFECT, payload: { notificationId: 'ntf_3' } },
    ]);
    expect(seen).toEqual([[['usr_002', 'usr_003']]]);
  });

  it('reads only the rows that this transaction inserted and that are unread', () => {
    expect(NEW_NOTICES_SQL).toContain('pg_current_xact_id_if_assigned()');
    expect(NEW_NOTICES_SQL).toMatch(/not n\.read/);
  });
});

describe('the registration of the mail effects', () => {
  const undo: (() => void)[] = [];
  afterEach(() => {
    while (undo.length > 0) undo.pop()!();
  });

  it('adds the notice producer to every shared write call except the read marks, and the two effect handlers', () => {
    undo.push(registerMailEffects());
    for (const [name, def] of Object.entries(sharedCalls)) {
      const has = (EFFECTS_OF[name as keyof typeof EFFECTS_OF] ?? []).length > 0;
      expect({ name, has }).toEqual({ name, has: !def.readOnly && !NOTICE_FREE_CALLS.has(name) });
    }
    expect(NOTICE_FREE_CALLS.has('notifications.markUnread')).toBe(true);
    expect(() => registerEffect(NOTICE_EFFECT, async () => undefined)).toThrow(/already registered/);
    expect(() => registerEffect(QUOTA_WARNING_EFFECT, async () => undefined)).toThrow(/already registered/);
  });

  it('registers once: a second call is refused, and the undo removes everything', () => {
    const remove = registerMailEffects();
    expect(() => registerMailEffects()).toThrow(/already registered/);
    remove();
    expect(EFFECTS_OF['tasks.create'] ?? []).toEqual([]);
    // The handler is free again.
    registerEffect(NOTICE_EFFECT, async () => undefined)();
  });
});

describe('sendNoticeMail: the mail of one notice', () => {
  it('sends one counted mail in the person\'s language with a link to the notices and no client data', async () => {
    const { mem, deps } = setup({ people: [person('usr_002', { preferences: withPrefs((p) => { p.language = 'ar'; }), gender: 'female' })] });
    await sendNoticeMail({ notificationId: 'ntf_1' }, deps);
    expect(deps.mail.sent).toHaveLength(1);
    const [mail] = deps.mail.sent;
    expect(mail).toMatchObject({ to: 'usr_002@madar.test', tag: 'notice', idempotencyKey: 'notice-ntf_1' });
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain('https://madar.test/notifications');
    expect(mail.text).toContain('افتحي مدار');
    expect(mem.log).toEqual([{ utc_day: DAY, kind: 'notice', user_id: 'usr_002', ref: 'notice-ntf_1', resend_id: 'mail_1' }]);
  });

  it('sends nothing for a notice that is gone, a person who left, an agent, or a switch that is off now', async () => {
    const cases: Person[] = [
      person('usr_002', { active: false }),
      person('usr_002', { kind: 'agent' }),
      person('usr_002', { preferences: withPrefs((p) => { p.email = { task_assigned: false }; }) }),
      person('usr_002', { preferences: withPrefs((p) => { p.notifications.task_assigned = false; }) }),
    ];
    for (const who of cases) {
      const { mem, deps } = setup({ people: [who] });
      await sendNoticeMail({ notificationId: 'ntf_1' }, deps);
      expect(deps.mail.sent).toEqual([]);
      expect(mem.log).toEqual([]);
    }
    const { deps } = setup({ notices: [] });
    await sendNoticeMail({ notificationId: 'ntf_1' }, deps);
    expect(deps.mail.sent).toEqual([]);
  });

  it('sends once when the effect runs twice: the place in the quota and the key stay the same', async () => {
    const { mem, deps } = setup();
    await sendNoticeMail({ notificationId: 'ntf_1' }, deps);
    await sendNoticeMail({ notificationId: 'ntf_1' }, deps);
    expect(mem.log.filter((r) => r.kind === 'notice')).toHaveLength(1);
    // The fake records both sends; Resend (and the outbox driver) keeps one mail for the one key.
    expect(new Set(deps.mail.sent.map((m) => m.idempotencyKey))).toEqual(new Set(['notice-ntf_1']));
  });

  it('throws when the send fails, so the outbox tries again with the same key', async () => {
    const { deps } = setup();
    deps.mail.failNext(new Error('Resend is down'));
    await expect(sendNoticeMail({ notificationId: 'ntf_1' }, deps)).rejects.toThrow('Resend is down');
    await sendNoticeMail({ notificationId: 'ntf_1' }, deps);
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toEqual(['notice-ntf_1']);
  });

  it('keeps notice 91 of the UTC day in the app and warns each Admin once', async () => {
    const people = [person('usr_002'), person('usr_001', { gender: 'female' }), person('usr_005')];
    const notices = [{ id: 'ntf_91', userId: 'usr_002', trigger: 'mention' }, { id: 'ntf_92', userId: 'usr_002', trigger: 'mention' }];
    const { mem, deps } = setup({ people, notices });
    const undo = registerEffect(QUOTA_WARNING_EFFECT, sendQuotaWarning);
    try {
      mem.fill('notice', 90, DAY);
      await sendNoticeMail({ notificationId: 'ntf_91' }, deps);
      await sendNoticeMail({ notificationId: 'ntf_92' }, deps);
    } finally {
      undo();
    }
    expect(deps.mail.sent.map((m) => [m.to, m.tag, m.idempotencyKey])).toEqual([
      ['usr_001@madar.test', 'quota-warning', `quota-warning-${DAY}-usr_001`],
      ['usr_005@madar.test', 'quota-warning', `quota-warning-${DAY}-usr_005`],
    ]);
    expect(mem.outbox.map((r) => [r.kind, r.payload, r.done])).toEqual([
      [QUOTA_WARNING_EFFECT, { userId: 'usr_001', day: DAY }, true],
      [QUOTA_WARNING_EFFECT, { userId: 'usr_005', day: DAY }, true],
    ]);
    expect(mem.log.filter((r) => r.kind === 'refused')).toHaveLength(1);
    expect(mem.log.filter((r) => r.kind === 'warning').map((r) => r.user_id)).toEqual(['usr_001', 'usr_005']);
  });

  it('names the daily limit in the warning and links to Admin', async () => {
    const { deps } = setup({ people: [person('usr_001')] });
    await sendQuotaWarning({ userId: 'usr_001', day: DAY }, deps);
    expect(deps.mail.sent[0].text).toContain('90');
    expect(deps.mail.sent[0].html).toContain('https://madar.test/admin');
  });
});

describe('appLink', () => {
  it('joins the screens URL and a path with one slash', () => {
    expect(appLink('https://madar.test/', '/notifications')).toBe('https://madar.test/notifications');
    expect(appLink('https://madar.test', '/work')).toBe('https://madar.test/work');
  });
});
