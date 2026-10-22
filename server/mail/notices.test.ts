import { afterEach, describe, expect, it } from 'vitest';
import { defaultPreferences, type Preferences } from '../../src/api/contract/entities';
import { sharedCalls } from '../../src/api/sharedCalls';
import { EFFECTS_OF, processOutbox, registerEffect, writeOutbox } from '../core/effects';
import { fakeDeps } from '../test/fakes/deps';
import { QUIET_SQL } from '../core/quiet';
import { memoryMailDb } from './memoryMailDb';
import {
  ADMINS_SQL, ADMIN_MAIL_SQL, CHAT_NOTICE_EFFECT, NEW_NOTICES_SQL, NOTICE_EFFECT, NOTICE_FREE_CALLS, NOTICE_MAIL_SQL, NOTICE_UNREAD_LITE, NOTICE_UNREAD_SQL, QUOTA_WARNING_EFFECT,
  USER_MAIL_SQL, appLink, noticeRows, sendChatNoticeMail, sendNoticeMail, sendQuotaWarning,
} from './notices';
import { registerMailEffects } from './register';

/**
 * The notice mail (plan 5.4; task N2.2): which new notices get an email, the mail itself, and the one Admin warning of a day.
 * The SQL runs on the local database in server/it/email.it.test.ts; here a small database in memory answers it.
 */

const DAY = '2026-10-04';
const NOW = new Date(`${DAY}T06:00:00Z`);

type Person = { id: string; kind: 'human' | 'agent'; active: boolean; email: string; preferences: Preferences; gender: string | null; systemRole: string };
const person = (id: string, more: Partial<Person> = {}): Person => ({
  id, kind: 'human', active: true, email: `${id}@madar.test`, preferences: defaultPreferences(), gender: null, systemRole: 'member', ...more,
});
const admin = (id: string, more: Partial<Person> = {}): Person => person(id, { systemRole: 'admin', ...more });
const withPrefs = (change: (p: Preferences) => void) => {
  const p = defaultPreferences();
  change(p);
  return p;
};

function setup(o: { people?: Person[]; notices?: { id: string; userId: string; trigger: string }[]; unread?: string[] } = {}) {
  const people = new Map((o.people ?? [person('usr_002')]).map((p) => [p.id, p]));
  const notices = o.notices ?? [{ id: 'ntf_1', userId: 'usr_002', trigger: 'task_assigned' }];
  // The notices that are still unread when the chat mail runs: all of them, unless a test says otherwise.
  const unread = o.unread ?? notices.map((n) => n.id);
  const mem = memoryMailDb((text, values) => {
    if (text === QUIET_SQL) return [{ person: null, office: null }];
    if (text === NOTICE_UNREAD_SQL) return unread.includes(values[0] as string) ? [{ id: values[0] }] : [];
    if (text === NOTICE_MAIL_SQL) {
      const n = notices.find((x) => x.id === values[0]);
      const p = n && people.get(n.userId);
      return n && p ? [{ id: n.id, trigger: n.trigger, user_id: p.id, kind: p.kind, active: p.active, email: p.email, preferences: p.preferences, gender: p.gender }] : [];
    }
    if (text === USER_MAIL_SQL) {
      const p = people.get(values[0] as string);
      return p ? [{ user_id: p.id, kind: p.kind, active: p.active, email: p.email, preferences: p.preferences, gender: p.gender }] : [];
    }
    if (text === ADMIN_MAIL_SQL) {
      const p = people.get(values[0] as string);
      return p ? [{ user_id: p.id, kind: p.kind, active: p.active, email: p.email, preferences: p.preferences, gender: p.gender, system_role: p.systemRole }] : [];
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
    // The Madar mark at the app address of the server config (TASKS.md, Logo, point 4).
    expect(mail.html).toContain('<img src="https://madar.test/icons/madar-192.png"');
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
    const people = [person('usr_002'), admin('usr_001', { gender: 'female' }), admin('usr_005')];
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
    const { deps } = setup({ people: [admin('usr_001')] });
    await sendQuotaWarning({ userId: 'usr_001', day: DAY }, deps);
    expect(deps.mail.sent[0].text).toContain('90');
    expect(deps.mail.sent[0].html).toContain('https://madar.test/admin');
    expect(deps.mail.sent[0].html).toContain('<img src="https://madar.test/icons/madar-192.png"');
  });

  it('reads the role when it sends: a person who is no longer an Admin, or who left, gets no warning', async () => {
    for (const who of [person('usr_001'), admin('usr_001', { active: false }), admin('usr_001', { kind: 'agent' })]) {
      const { mem, deps } = setup({ people: [who] });
      await sendQuotaWarning({ userId: 'usr_001', day: DAY }, deps);
      expect(deps.mail.sent).toEqual([]);
      expect(mem.log).toEqual([]);
      expect(mem.statements).toContain(ADMIN_MAIL_SQL);
    }
  });
});

// The notices of requests and bugs stay in the app, and a person stored before them still gets mail (owner, 2026-10-07).
describe('the notices that stay in the app', () => {
  const OLD = [
    'task_assigned', 'mention', 'due_tomorrow', 'overdue', 'review_requested', 'task_approved', 'task_sent_back', 'stage_changed', 'added_to_project', 'resume_due',
  ];
  const oldPrefs = (): Preferences => ({ ...defaultPreferences(), notifications: Object.fromEntries(OLD.map((trigger) => [trigger, true])) });
  const rowsFor = (rows: unknown[]) => (async () => rows) as never;

  it('writes no mail row for a new report or a done report, even with the email switch on', async () => {
    const prefs = withPrefs((p) => { p.email = { feedback_sent: true, feedback_done: true }; });
    const q = rowsFor([
      { id: 'ntf_1', user_id: 'usr_001', trigger: 'feedback_sent', kind: 'human', active: true, preferences: prefs },
      { id: 'ntf_2', user_id: 'usr_003', trigger: 'feedback_done', kind: 'human', active: true, preferences: prefs },
    ]);
    expect(await noticeRows(q, { kinds: new Set(['notifications', 'feedback']), people: new Set(['usr_001', 'usr_003']) })).toEqual([]);
  });

  it('writes no mail row for a meeting notice or its reminder, even with the email switch on (fbk_022)', async () => {
    const prefs = withPrefs((p) => { p.email = { meeting_invited: true, meeting_soon: true }; });
    const q = rowsFor([
      { id: 'ntf_7', user_id: 'usr_003', trigger: 'meeting_invited', kind: 'human', active: true, preferences: prefs },
      { id: 'ntf_8', user_id: 'usr_004', trigger: 'meeting_soon', kind: 'human', active: true, preferences: prefs },
    ]);
    expect(await noticeRows(q, { kinds: new Set(['notifications', 'meetings']), people: new Set(['usr_003', 'usr_004']) })).toEqual([]);
  });

  it('still writes a mail row for a mention to a person with the 10 old switches only, and reads a missing switch as on', async () => {
    const missing = withPrefs((p) => { delete p.notifications.mention; });
    const q = rowsFor([
      { id: 'ntf_3', user_id: 'usr_002', trigger: 'mention', kind: 'human', active: true, preferences: oldPrefs() },
      { id: 'ntf_6', user_id: 'usr_004', trigger: 'mention', kind: 'human', active: true, preferences: missing },
    ]);
    expect(await noticeRows(q, { kinds: new Set(['notifications']), people: new Set(['usr_002', 'usr_004']) })).toEqual([
      { kind: NOTICE_EFFECT, payload: { notificationId: 'ntf_3' } },
      { kind: NOTICE_EFFECT, payload: { notificationId: 'ntf_6' } },
    ]);
  });

  it('sends no mail for a done report, and a mail for a mention to a person with the old switches or a missing switch', async () => {
    const prefs = withPrefs((p) => { p.email = { feedback_done: true }; });
    const missing = withPrefs((p) => { delete p.notifications.mention; });
    const notices = [
      { id: 'ntf_4', userId: 'usr_003', trigger: 'feedback_done' }, { id: 'ntf_5', userId: 'usr_002', trigger: 'mention' }, { id: 'ntf_6', userId: 'usr_004', trigger: 'mention' },
    ];
    const people = [person('usr_003', { preferences: prefs }), person('usr_002', { preferences: oldPrefs() }), person('usr_004', { preferences: missing })];
    const { mem, deps } = setup({ people, notices });
    await sendNoticeMail({ notificationId: 'ntf_4' }, deps);
    expect(deps.mail.sent).toEqual([]);
    expect(mem.log).toEqual([]);
    await sendNoticeMail({ notificationId: 'ntf_5' }, deps);
    await sendNoticeMail({ notificationId: 'ntf_6' }, deps);
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toEqual(['notice-ntf_5', 'notice-ntf_6']);
  });
});

describe('appLink', () => {
  it('joins the screens URL and a path with one slash', () => {
    expect(appLink('https://madar.test/', '/notifications')).toBe('https://madar.test/notifications');
    expect(appLink('https://madar.test', '/work')).toBe('https://madar.test/work');
  });
});

describe('the mention mail of a chat waits and skips a read notice (chat design item 20)', () => {
  const undo: (() => void)[] = [];
  afterEach(() => {
    while (undo.length > 0) undo.pop()!();
  });
  const mention = (id: string, userId: string, target_type: string, message_id: string | null) => ({
    id, user_id: userId, trigger: 'mention', kind: 'human', active: true, preferences: defaultPreferences(), target_type, message_id,
  });

  it('writes a mail.chatNotice row for a new mention notice of a chat message or a task comment, and mail.notice for any other', async () => {
    const q = (async (text: string) => {
      expect(text).toBe(NEW_NOTICES_SQL);
      return [
        mention('ntf_1', 'usr_002', 'chat', 'msg_9'),
        mention('ntf_2', 'usr_002', 'task', 'cmt_9'),
        mention('ntf_3', 'usr_002', 'update', 'cmt_8'),
        { ...mention('ntf_4', 'usr_002', 'task', null), trigger: 'task_assigned' },
      ];
    }) as never;
    const rows = await noticeRows(q, { kinds: new Set(['notifications']), people: new Set(['usr_002']) });
    expect(rows.map((r) => [r.kind, r.payload.notificationId])).toEqual([
      [CHAT_NOTICE_EFFECT, 'ntf_1'], [CHAT_NOTICE_EFFECT, 'ntf_2'], [NOTICE_EFFECT, 'ntf_3'], [NOTICE_EFFECT, 'ntf_4'],
    ]);
  });

  it('reads the target and the message of each notice', () => {
    expect(NEW_NOTICES_SQL).toContain('n.target_type');
    expect(NEW_NOTICES_SQL).toContain("n.doc->>'messageId' as message_id");
  });

  it('sendChatNoticeMail sends nothing for a notice that is read by now, or gone', async () => {
    const { mem, deps } = setup({ notices: [{ id: 'ntf_1', userId: 'usr_002', trigger: 'mention' }], unread: [] });
    await sendChatNoticeMail({ notificationId: 'ntf_1' }, deps);
    expect(deps.mail.sent).toEqual([]);
    expect(mem.log).toEqual([]);
    expect(mem.statements).toEqual([NOTICE_UNREAD_SQL]);
  });

  it('sendChatNoticeMail sends the notice mail with the key notice-<id> when the notice is still unread', async () => {
    const { mem, deps } = setup({ notices: [{ id: 'ntf_1', userId: 'usr_002', trigger: 'mention' }] });
    await sendChatNoticeMail({ notificationId: 'ntf_1' }, deps);
    expect(deps.mail.sent.map((m) => [m.to, m.tag, m.idempotencyKey])).toEqual([['usr_002@madar.test', 'notice', 'notice-ntf_1']]);
    expect(mem.log.filter((r) => r.kind === 'notice')).toHaveLength(1);
  });

  it('keeps the SQLite form of the unread test', () => {
    expect(NOTICE_UNREAD_SQL).toBe('select id from notifications where id = $1 and not read');
    expect(NOTICE_UNREAD_LITE).toBe('select id from notifications where id = ?1 and read = 0');
  });

  it('registers mail.chatNotice with registerMailEffects: processOutbox runs a mail.chatNotice row', async () => {
    const { mem, deps } = setup({ notices: [{ id: 'ntf_1', userId: 'usr_002', trigger: 'mention' }] });
    undo.push(registerMailEffects());
    const [id] = await writeOutbox(mem.q, [{ kind: CHAT_NOTICE_EFFECT, payload: { notificationId: 'ntf_1' } }]);
    expect(await processOutbox(deps, [id])).toEqual({ done: [id], failed: [] });
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toEqual(['notice-ntf_1']);
    expect(() => registerEffect(CHAT_NOTICE_EFFECT, async () => undefined)).toThrow(/already registered/);
  });
});
