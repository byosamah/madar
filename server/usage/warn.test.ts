import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultPreferences, type Preferences } from '../../src/api/contract/entities';
import type { Config } from '../core/ports';
import { memoryMailDb } from '../mail/memoryMailDb';
import { ADMINS_SQL } from '../mail/notices';
import { SENT_TODAY_SQL } from '../mail/quota';
import { renderMail } from '../mail/templates';
import { fakeDeps } from '../test/fakes/deps';
import { METERS_SQL, STORAGE_PRESENT_SQL } from './meters';
import { registerUsageEffects } from './register';
import { ADMIN_MAIL_SQL, LIMIT_WARNING_EFFECT, WARNING_MARK_SQL, checkLimits, sendLimitWarning } from './warn';

/**
 * The 80% warning (plan 5.8; task M1): one email to each active Admin when a meter passes 80%, once for each meter and month.
 * The mail goes through the outbox and the warning quota of N2. A small database in memory answers the SQL here;
 * server/it/usage.it.test.ts runs the same flow on the local database.
 */

const GB = 1024 * 1024 * 1024;
const NOW = new Date('2026-10-04T06:00:00Z');

type Person = { id: string; active: boolean; email: string; preferences: Preferences; gender: string | null; systemRole: string };
const person = (id: string, more: Partial<Person> = {}): Person => ({ id, active: true, email: `${id}@madar.test`, preferences: defaultPreferences(), gender: null, systemRole: 'admin', ...more });

type MeterValues = { calls: number; bytes_read: number; backup_bytes: number | null; database_bytes: number; files_bytes: number; emails_month: number };
const CALM: MeterValues = { calls: 10, bytes_read: 0, backup_bytes: null, database_bytes: 1000, files_bytes: 0, emails_month: 0 };

function setup(o: { meters?: Partial<MeterValues>; people?: Person[]; config?: Partial<Config> } = {}) {
  let meters: MeterValues = { ...CALM, ...o.meters };
  const people = new Map((o.people ?? [person('usr_001'), person('usr_005')]).map((p) => [p.id, p]));
  const marks = new Set<string>();
  const mem = memoryMailDb((text, values) => {
    if (text === METERS_SQL) return [Object.fromEntries(Object.entries(meters).map(([k, v]) => [k, v === null ? null : String(v)]))];
    if (text === SENT_TODAY_SQL) return [{ n: mem.log.filter((r) => r.utc_day === values[0] && r.kind !== 'refused').length }];
    // No bucket function here, as in the db-mode harness: files_bytes from the file records drives the files meter.
    if (text === STORAGE_PRESENT_SQL) return [{ present: false }];
    if (text === ADMINS_SQL) return [...people.values()].filter((p) => p.active && p.systemRole === 'admin').map((p) => ({ id: p.id }));
    if (text === ADMIN_MAIL_SQL) {
      const p = people.get(values[0] as string);
      return p ? [{ user_id: p.id, kind: 'human', active: p.active, email: p.email, preferences: p.preferences, gender: p.gender, system_role: p.systemRole }] : [];
    }
    if (text === WARNING_MARK_SQL) {
      const key = `${values[0]}|${values[1]}`;
      if (marks.has(key)) return [];
      marks.add(key);
      return [{ metric: values[1] }];
    }
    return undefined;
  });
  const deps = fakeDeps({ db: mem.db, config: { appUrl: 'https://madar.test', ...o.config } });
  deps.clock.set(NOW);
  return { mem, deps, people, marks, setMeters: (next: Partial<MeterValues>) => (meters = { ...meters, ...next }) };
}

let undo: () => void;
beforeEach(() => {
  undo = registerUsageEffects();
});
afterEach(() => undo());

describe('checkLimits (plan 5.8)', () => {
  it('sends nothing and writes nothing while every meter is under 80%', async () => {
    const { mem, deps } = setup({ meters: { files_bytes: 0.79 * GB } });
    expect(await checkLimits(deps)).toEqual({ warned: [] });
    expect(deps.mail.sent).toEqual([]);
    expect(mem.statements).not.toContain(WARNING_MARK_SQL);
  });

  it('mails each active Admin once when file storage passes 80% of 1 GB, with the next step: the move to R2 or removing old versions', async () => {
    const { mem, deps } = setup({ meters: { files_bytes: 0.85 * GB }, people: [person('usr_001'), person('usr_005'), person('usr_007', { active: false })] });
    expect(await checkLimits(deps)).toEqual({ warned: ['files'] });
    expect(deps.mail.sent.map((m) => [m.to, m.tag, m.idempotencyKey])).toEqual([
      ['usr_001@madar.test', 'limit-warning', 'limit-warning-2026-10-files-usr_001'],
      ['usr_005@madar.test', 'limit-warning', 'limit-warning-2026-10-files-usr_005'],
    ]);
    const expected = renderMail('limitWarning', 'en', { meter: 'files', percent: 85, link: 'https://madar.test/admin' });
    expect(deps.mail.sent[0]).toMatchObject({ subject: expected.subject, text: expected.text });
    expect(deps.mail.sent[0].text).toContain('Next step: move the files to Cloudflare R2, or remove old file versions.');
    // Through the outbox (kind and payload, no address) and the warning quota of N2.
    expect(mem.outbox.map((r) => [r.kind, r.payload, r.done])).toEqual([
      [LIMIT_WARNING_EFFECT, { userId: 'usr_001', meter: 'files', percent: 85, month: '2026-10' }, true],
      [LIMIT_WARNING_EFFECT, { userId: 'usr_005', meter: 'files', percent: 85, month: '2026-10' }, true],
    ]);
    expect(mem.log.map((r) => [r.kind, r.ref])).toEqual([
      ['warning', 'limit-warning-2026-10-files-usr_001'],
      ['warning', 'limit-warning-2026-10-files-usr_005'],
    ]);
  });

  it('sends one warning at 80%, not one for each request or each run', async () => {
    const { deps, setMeters } = setup({ meters: { calls: 400_000 } });
    await checkLimits(deps);
    setMeters({ calls: 450_000 });
    await checkLimits(deps);
    expect(await checkLimits(deps)).toEqual({ warned: [] });
    expect(deps.mail.sent).toHaveLength(2);
  });

  it('warns again in a new month', async () => {
    const { deps } = setup({ meters: { database_bytes: 450 * 1024 * 1024 } });
    await checkLimits(deps);
    deps.clock.set('2026-11-01T00:30:00Z');
    expect(await checkLimits(deps)).toEqual({ warned: ['database'] });
    expect(deps.mail.sent.map((m) => m.idempotencyKey)).toEqual([
      'limit-warning-2026-10-database-usr_001', 'limit-warning-2026-10-database-usr_005',
      'limit-warning-2026-11-database-usr_001', 'limit-warning-2026-11-database-usr_005',
    ]);
  });

  it('names each meter as the limitWarning mail of N2 does, and gives each its own warning', async () => {
    const { deps } = setup({ meters: { calls: 450_000, bytes_read: 4.5 * GB, emails_month: 2500 }, people: [person('usr_001')] });
    expect((await checkLimits(deps)).warned).toEqual(['calls', 'emailsMonth', 'egress']);
    expect(deps.mail.sent).toHaveLength(3);
  });

  it('counts the emails of today as N2 counts them, and warns at 80 of 100', async () => {
    const { mem, deps } = setup({ people: [person('usr_001')] });
    mem.fill('notice', 80, '2026-10-04');
    expect((await checkLimits(deps)).warned).toEqual(['emailsToday']);
  });

  it('uses the R2 meter and its own next step when the files are on R2 (10 GB)', async () => {
    const { deps } = setup({ meters: { files_bytes: 9 * GB }, people: [person('usr_001')], config: { fileStore: 'r2', limits: { maxFileBytes: 250 * 1024 * 1024, filesTotalBytes: 10 * GB } } });
    expect((await checkLimits(deps)).warned).toEqual(['filesR2']);
    expect(deps.mail.sent[0].text).toContain(renderMail('limitWarning', 'en', { meter: 'filesR2', percent: 90, link: 'https://madar.test/admin' }).text.split('\n').find((line) => line.includes('R2'))!);
  });

  it('keeps a mail that failed in the outbox with its error, for the job and the usage panel', async () => {
    const { mem, deps } = setup({ meters: { files_bytes: 0.9 * GB }, people: [person('usr_001')] });
    deps.mail.failNext(new Error('Resend is away.'));
    expect((await checkLimits(deps)).warned).toEqual(['files']);
    expect(mem.outbox).toEqual([expect.objectContaining({ kind: LIMIT_WARNING_EFFECT, done: false, error: 'Resend is away.' })]);
  });

  it('never marks a warning done when the warning quota of today is full: the row keeps its error, so the Admin sees it in Usage', async () => {
    const { mem, deps } = setup({ meters: { files_bytes: 0.9 * GB }, people: [person('usr_001')] });
    mem.fill('notice', 98, '2026-10-04');
    expect((await checkLimits(deps)).warned).toEqual(['files', 'emailsToday']);
    expect(deps.mail.sent).toEqual([]);
    expect(mem.outbox.map((r) => [r.kind, r.done, r.error])).toEqual([
      [LIMIT_WARNING_EFFECT, false, 'The warning quota of today is full.'],
      [LIMIT_WARNING_EFFECT, false, 'The warning quota of today is full.'],
    ]);
  });
});

describe('sendLimitWarning (the usage.limitWarning effect)', () => {
  const payload = { userId: 'usr_001', meter: 'files', percent: 85, month: '2026-10' };

  it('writes in the Admin\'s language, with the female forms for a female reader', async () => {
    const prefs = defaultPreferences();
    prefs.language = 'ar';
    const { deps } = setup({ people: [person('usr_001', { preferences: prefs, gender: 'female' })] });
    await sendLimitWarning(payload, deps);
    const expected = renderMail('limitWarning', 'ar', { meter: 'files', percent: 85, link: 'https://madar.test/admin' }, { reader: 'female' });
    expect(deps.mail.sent[0]).toMatchObject({ subject: expected.subject, html: expected.html });
  });

  it('sends nothing to a person who left or was turned off', async () => {
    const { deps } = setup({ people: [person('usr_001', { active: false })] });
    await sendLimitWarning(payload, deps);
    await sendLimitWarning({ ...payload, userId: 'usr_404' }, deps);
    expect(deps.mail.sent).toEqual([]);
  });

  it('sends nothing to a person who is no longer an Admin when the effect runs', async () => {
    const { deps, people } = setup();
    people.get('usr_001')!.systemRole = 'member';
    await sendLimitWarning(payload, deps);
    expect(deps.mail.sent).toEqual([]);
  });

  it('keeps to the warning quota: at the hard stop of 98 the warning does not go, and the effect fails so its row stays for the job', async () => {
    const { mem, deps } = setup();
    mem.fill('notice', 98, '2026-10-04');
    await expect(sendLimitWarning(payload, deps)).rejects.toThrow('The warning quota of today is full.');
    expect(deps.mail.sent).toEqual([]);
  });

  it('refuses a payload with a meter that the mail does not know, so the row shows as failed', async () => {
    const { deps } = setup();
    await expect(sendLimitWarning({ ...payload, meter: 'disk' }, deps)).rejects.toThrow(/disk/);
  });

  it('sends each warning once when the effect runs twice (one quota place, one idempotency key)', async () => {
    const { mem, deps } = setup();
    await sendLimitWarning(payload, deps);
    await sendLimitWarning(payload, deps);
    expect(new Set(deps.mail.sent.map((m) => m.idempotencyKey)).size).toBe(1);
    expect(mem.log.filter((r) => r.kind === 'warning')).toHaveLength(1);
  });
});
