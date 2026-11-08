import { User, defaultPreferences } from '../../src/api/contract/entities';
import { emptyState } from '../../src/api/store';
import { INVITE_KIND, inviteRow } from '../auth/invite';
import { importSigninRows, type SigninExportRow } from '../auth/own/import';
import { processOutbox, writeOutbox } from '../core/effects';
import type { Clock, Deps } from '../core/ports';
import type { LiteDb } from '../data/lite/db';
import { insertRow } from '../data/lite/save';
import { DEFAULT_SETTINGS } from '../data/lite/schema';
import { rowOf } from '../data/rows';
import { TABLES } from '../data/tables';
import type { EnterpriseFacts } from './facts';
import type { EnterpriseGate } from './gate';
import { normalizeEmail } from './ids';
import type { EnterpriseInit } from './types';

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
