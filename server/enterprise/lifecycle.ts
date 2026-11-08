import { User, defaultPreferences } from '../../src/api/contract/entities';
import { ApiError } from '../../src/api/errors';
import { emptyState } from '../../src/api/store';
import { hitLimit } from '../auth/rateLimit';
import { RESEND_PER_DAY } from '../calls/people';
import { INVITE_KIND, inviteRow } from '../auth/invite';
import { importSigninRows, type SigninExportRow } from '../auth/own/import';
import { processOutbox, writeOutbox } from '../core/effects';
import type { Clock, Deps } from '../core/ports';
import { liteDbOf, type LiteDb } from '../data/lite/db';
import { readLiteOffice, writeOfficeSnapshot } from '../data/lite/office';
import { insertRow } from '../data/lite/save';
import { DEFAULT_SETTINGS } from '../data/lite/schema';
import { rowOf } from '../data/rows';
import { TABLES } from '../data/tables';
import type { EnterpriseFacts } from './facts';
import type { EnterpriseGate } from './gate';
import { normalizeEmail } from './ids';
import type { EnterpriseInit, EnterpriseLimits, EnterpriseState } from './types';

/**
 * The life of one enterprise object (Madar enterprises, plan C): the first start (init) and the changes that the platform makes later
 * (state, limits, identity, owners, person, invitation). The object class and the parts call these functions.
 */

/** The first Admin of every enterprise is usr_001: the counters start at 1, so the next person is usr_002. */
export const FIRST_ADMIN_ID = 'usr_001';

/**
 * The project code prefix of a new enterprise: the first two letters of its address name, in capitals. The digits and hyphens are not
 * letters. 'acme-co' gives 'AC', 'x9y' gives 'XY'. An address with one letter gives one (the Settings rule allows 1 to 4).
 */
export function codePrefixOf(address: string): string {
  return address.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
}

export type InitOptions = {
  db: LiteDb;
  clock: Clock;
  gate: EnterpriseGate;
  facts: EnterpriseFacts;
  /** The Deps of the call. It is made after the identity row exists, so the invitation link carries the tag of the enterprise. */
  depsFor: () => Deps;
};

/**
 * Makes the enterprise in this object, in one write transaction, then queues the invitation of the first Admin once. A second call with the
 * same input changes nothing and queues no second invitation. Day one holds the code defaults only (design D1): no template, no client, no
 * sub-company, no Resources folder and no sample content. The first Admin gets no History event.
 */
export async function initEnterprise(o: InitOptions, input: EnterpriseInit): Promise<{ adminUserId: string }> {
  const now = o.clock.now();
  const email = normalizeEmail(input.admin.email);
  if (!(await o.gate.load())) {
    const settings = {
      ...DEFAULT_SETTINGS,
      defaultStages: [...DEFAULT_SETTINGS.defaultStages],
      codePrefix: input.codePrefix,
      enterpriseName: input.name,
      enterpriseNameAr: input.nameAr,
      ...(input.logo ? { enterpriseLogo: input.logo } : {}),
    };
    const admin = User.parse({
      id: FIRST_ADMIN_ID, name: input.admin.name, email, avatarUrl: null, kind: 'human', systemRole: 'admin', discipline: 'Administration',
      active: true, ownerId: null, preferences: { ...defaultPreferences(), language: input.admin.language },
    });
    const signin: SigninExportRow = { id: crypto.randomUUID(), email, password_hash: null, email_confirmed: false, banned: false, password_set: false, user_id: FIRST_ADMIN_ID };
    const users = TABLES.find((spec) => spec.table === 'users')!;
    const state = emptyState(now.toISOString().slice(0, 10));
    await o.db.tx('write', async (q) => {
      await q('insert into enterprise (id, state, limits, created_at) values (?1, ?2, ?3, ?4)', [input.ent, 'active', JSON.stringify(input.limits), now.toISOString()]);
      await q("update settings set doc = ?1 where id = 'office'", [JSON.stringify(settings)]);
      await insertRow(q, users, rowOf(users, admin as unknown as Record<string, unknown>, state), state, 'fail');
      await q('insert into counters (prefix, n) values (?1, ?2) on conflict (prefix) do update set n = excluded.n', ['usr', 1]);
      // The sign-in row, one office version and one snapshot with the link of the first Admin (the rule of the import).
      await importSigninRows(q, [signin], now);
    });
  }
  o.gate.forget();
  await o.gate.load();
  o.facts.forget();
  await o.facts.load(o.db, o.gate.current() ?? null);
  // The invitation goes out once: a repeat of init finds the outbox row and queues nothing. A row that did not send stays for the job.
  const [queued] = await o.db.statement('read', 'select 1 as n from outbox where kind = ?1 limit 1', [INVITE_KIND]);
  if (!queued) {
    const ids = await o.db.tx('write', (q) => writeOutbox(q, [inviteRow(FIRST_ADMIN_ID)]));
    await processOutbox(o.depsFor(), ids);
  }
  return { adminUserId: FIRST_ADMIN_ID };
}

// ---- The changes of a made enterprise (plan C, Task 6) ----

/** The limits of the object, as the table enterprise keeps them (JSON text), and the facts in memory. */
export async function writeLimits(o: Pick<InitOptions, 'db' | 'gate' | 'facts'>, limits: EnterpriseLimits): Promise<void> {
  await o.db.tx('write', (q) => q('update enterprise set limits = ?1', [JSON.stringify(limits)]));
  o.gate.forget();
  await o.gate.load();
  o.facts.set({ limits });
}

/** The state of the object: active or paused. A creating row is never written back (the platform keeps that state). */
export async function writeState(o: Pick<InitOptions, 'db' | 'gate' | 'facts'>, state: EnterpriseState): Promise<void> {
  if (state === 'creating') throw new ApiError('invalid_input', 'An object takes the state active or paused.');
  await o.db.tx('write', (q) => q('update enterprise set state = ?1', [state]));
  o.gate.forget();
  await o.gate.load();
  o.facts.set({ state });
}

/**
 * The name, the Arabic name and the logo, into the Settings row. One transaction: the row, the office version and the snapshot, so the next
 * read of the office sees them (the rule of lite/office.ts).
 */
export async function writeIdentity(db: LiteDb, brand: { name: string; nameAr: string; logo: string | null }): Promise<void> {
  await db.tx('write', async (q) => {
    const office = await readLiteOffice(liteDbOf(q), q);
    const { enterpriseLogo: _old, ...rest } = office.lists.settings;
    const settings = { ...rest, enterpriseName: brand.name, enterpriseNameAr: brand.nameAr, ...(brand.logo ? { enterpriseLogo: brand.logo } : {}) };
    await q("update settings set doc = ?1 where id = 'office'", [JSON.stringify(settings)]);
    const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
    await writeOfficeSnapshot(q, { ...office.lists, settings }, Number(meta.version));
  });
}

/** The user ids that are platform owners in this enterprise (enterprise_use.owners), and the facts in memory. */
export async function writePlatformOwners(o: Pick<InitOptions, 'db' | 'facts'>, userIds: readonly string[]): Promise<void> {
  const owners = [...new Set(userIds)].sort();
  await o.db.tx('write', (q) => q('update enterprise_use set owners = ?1 where id = 1', [JSON.stringify(owners)]));
  o.facts.set({ owners });
}

/** The invitation of the first Admin, again. It refuses when the Admin set a password, and after 5 sends in a day (the rule of users.resendInvite). */
export async function reinviteAdmin(o: Pick<InitOptions, 'db' | 'clock' | 'depsFor'>): Promise<{ sentAt: string }> {
  const [admin] = await o.db.statement<{ password_set: number }>('read', 'select password_set from auth_users where user_id = ?1', [FIRST_ADMIN_ID]);
  if (!admin) throw new ApiError('not_found', 'This enterprise has no first Admin yet.');
  if (Number(admin.password_set) === 1) throw new ApiError('conflict', 'This person accepted the invitation already.', { reason: 'already_accepted' });
  const now = o.clock.now();
  const ids = await o.db.tx('write', async (q) => {
    const limit = await hitLimit(q, { key: `invite:${FIRST_ADMIN_ID}`, limit: RESEND_PER_DAY, windowMs: 24 * 60 * 60 * 1000, now });
    if (!limit.ok) {
      throw new ApiError('conflict', `This person got ${RESEND_PER_DAY} invitations today. Try again tomorrow.`, { reason: 'invite_limit', retryAfterMs: limit.retryAfterMs });
    }
    return writeOutbox(q, [inviteRow(FIRST_ADMIN_ID)]);
  });
  await processOutbox(o.depsFor(), ids);
  return { sentAt: now.toISOString() };
}
