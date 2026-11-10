import { ApiError } from '../../../src/api/errors';
import { FORGOT_ADDRESS_LIMIT } from '../../auth/forgot';
import { ADDRESS_LIMITS } from '../../auth/own/limits';
import { hashedKey, hitLimit, limitAddress } from '../../auth/rateLimit';
import { RENEW_ADDRESS_LIMIT } from '../../auth/renew';
import { statementQuery } from '../../data/dialect';
import { runSigninOp, type OpInput, type OpResult, type SigninOpName } from '../../auth/own/office';
import { signingKeysOf, type SigningKeys } from '../../auth/own/keys';
import { knownKeyOf } from '../../auth/own/knownKey';
import { OWN_AUTH_SECRET } from '../../auth/ownKeys';
import { consoleLogger, serverEnvFrom, type ReadEnv } from '../../core/deps';
import type { Clock, Deps, Logger } from '../../core/ports';
import { liteDb, type LiteDb } from '../../data/lite/db';
import type { SqlHost } from '../../data/lite/host';
import { RATE_LIMIT_KEEP_MS, RATE_LIMITS_CLEANUP_LITE } from '../../jobs/steps/cleanup';
import type { OfficeMailAnswer, OfficeMailInput } from '../../office/parts';
import { isEnterpriseId, normalizeEmail, type EnterpriseId } from '../ids';
import { runMailRoute } from '../mailRoute';
import type { DayCounts, EnterpriseRow, EnterpriseStatus } from '../types';
import { mailReserve } from './mailPool';
import { PLATFORM_SCHEMA_VERSION } from './schema';
import { accountStop, capVerdict, planFrom, type Plan } from '../plan';
import { activateEnterprise, activeEnterpriseIds, createEnterprise, getEnterprise, listEnterprises, setEnterpriseState, updateEnterprise } from './enterprises';
import type { AddressAnswer, AddressStep, CapAnswer, PlatformStub } from './stub';
import {
  cleanupPlatformMemory, outcomeOf, platformAccount, platformAccounts, platformRefresh, platformSignIn, platformSignOut, type AccountDeps,
} from './accounts';

/**
 * The work of the platform object (Madar enterprises, plan B Task 7), apart from workerd: object.ts gives it the host of ctx.storage, and
 * node tests give it node:sqlite. It holds the list of enterprises, the email directory, the owners, the status rows and the account
 * meter. It never holds a record of an enterprise. The three refuse steps run the real code of an unknown input on empty tables.
 */

export type PlatformPartsInput = { host: SqlHost; read: ReadEnv; clock?: Clock; log?: Logger };
export type PlatformParts = PlatformStub & { readonly db: LiteDb };

const CONFLICT = new ApiError('conflict', 'This email or this address is taken.', { reason: 'email_taken' });
/** Keys that throw when read: the three refuse steps fail before they sign anything, and a read would be a defect. */
const NO_KEYS = new Proxy({}, { get: () => { throw new Error('The platform object holds no signing key.'); } }) as unknown as SigningKeys;
/** The value that the refuse steps pass as ent. A refusal never reaches a token or a company, so nothing reads it. It is no real enterprise id. */
const REFUSE_PLACEHOLDER: EnterpriseId = 'ent_000';

function entOf(value: unknown): EnterpriseId {
  if (!isEnterpriseId(value)) throw new ApiError('invalid_input', 'This is not an enterprise id.');
  return value;
}

/** The limit of the network address of each step: the same prefix, number and window that the step itself uses on the local path. */
const ADDRESS_STEP_LIMITS: Readonly<Record<AddressStep, { prefix: string; limit: number; windowMs: number }>> = {
  'auth.password': { prefix: ADDRESS_LIMITS['auth.password'].prefix, ...ADDRESS_LIMITS['auth.password'].limit },
  'auth.verify': { prefix: ADDRESS_LIMITS['auth.verify'].prefix, ...ADDRESS_LIMITS['auth.verify'].limit },
  forgot: FORGOT_ADDRESS_LIMIT,
  renew: RENEW_ADDRESS_LIMIT,
};

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

export function platformParts(o: PlatformPartsInput): PlatformParts {
  const db = liteDb(o.host);
  const clock = o.clock ?? { now: () => new Date() };
  const log = o.log ?? consoleLogger();
  // The config of a Worker (the mail address, the MCP address): the refuse steps read it as the object does.
  const values = serverEnvFrom(o.read, { database: { writeUrl: '', readUrl: '' } });
  const config = values.config;
  // The key of the known sign-in addresses of the platform accounts (review 2026-11-10, server/auth/own/knownKey.ts): HKDF from the server
  // secret key, with the info text madar-known-address:platform. The secret is in no database and in no backup. The refuse steps use it too,
  // so they do the same work as an office object (they read an empty table and write no row).
  const knownKey = knownKeyOf(values.secretKey, 'platform');
  const depsForRefuse = { db, clock, log, config } as unknown as Deps;

  // The plan settings (Free limits and the share), read from the settings of the Worker when first needed. A bad value throws an error that names it.
  let plan: Plan | undefined;
  const planOf = (): Plan => (plan ??= planFrom(o.read));

  // The keys of the platform tokens, imported once for each value of the secret. They sign after the hash work, outside a transaction.
  let held: { text: string; keys: Promise<SigningKeys> } | undefined;
  const keysOf = (): Promise<SigningKeys> => {
    const text = o.read(OWN_AUTH_SECRET);
    if (text === undefined || text === '') return Promise.reject(new Error(`${OWN_AUTH_SECRET} is not set: the platform cannot sign a token.`));
    if (held?.text !== text) {
      const keys = signingKeysOf(text, config.mcpUrl);
      held = { text, keys };
      keys.catch(() => {
        if (held?.keys === keys) held = undefined;
      });
    }
    return held.keys;
  };
  const accountDeps: AccountDeps = { db, clock, keys: keysOf, knownKey };

  /** The day counts of every enterprise for one UTC day, and their sum: the account. */
  async function sums(day: string): Promise<{ account: DayCounts; byEnterprise: { ent: EnterpriseId; counts: DayCounts }[] }> {
    const rows = await db.statement<{ ent: string; requests: number; rows_read: number; rows_written: number; mails: number }>(
      'read', 'select ent, requests, rows_read, rows_written, mails from account_day where day = ?1 order by ent', [day]);
    const byEnterprise = rows.map((row) => ({ ent: row.ent, counts: { requests: count(row.requests), rowsRead: count(row.rows_read), rowsWritten: count(row.rows_written), mails: count(row.mails) } }));
    const account = byEnterprise.reduce<DayCounts>(
      (sum, one) => ({ requests: sum.requests + one.counts.requests, rowsRead: sum.rowsRead + one.counts.rowsRead, rowsWritten: sum.rowsWritten + one.counts.rowsWritten, mails: sum.mails + one.counts.mails }),
      { requests: 0, rowsRead: 0, rowsWritten: 0, mails: 0 });
    return { account, byEnterprise };
  }

  return {
    db,

    async resolveEmail({ email }) {
      const [row] = await db.statement<{ ent: string }>('read', 'select ent from emails where email = ?1', [email]);
      return row ? { ent: row.ent } : null;
    },

    async resolveAddress({ address }) {
      const [row] = await db.statement<{ id: string }>('read', "select id from enterprises where address = ?1 and state in ('active', 'paused')", [address]);
      return row ? { ent: row.id } : null;
    },

    async listed() {
      const rows = await db.statement<{ id: string }>('read', "select id from enterprises where state in ('active', 'paused') order by id");
      return rows.map((row) => row.id);
    },

    async reserveEmail({ ent, email }) {
      entOf(ent);
      const key = normalizeEmail(email);
      return db.tx('write', async (q) => {
        const [found] = await q<{ ent: string }>('select ent from emails where email = ?1', [key]);
        if (found) return found.ent === ent ? 'ok' : 'taken';
        await q('insert into emails (email, ent) values (?1, ?2)', [key, ent]);
        return 'ok';
      });
    },

    async releaseEmail({ ent, email }) {
      await db.statement('write', 'delete from emails where email = ?1 and ent = ?2', [normalizeEmail(email), ent]);
    },

    async report(input: EnterpriseStatus) {
      entOf(input.ent);
      await db.tx('write', async (q) => {
        await q('insert into status (ent, doc, at) values (?1, ?2, ?3) on conflict (ent) do update set doc = excluded.doc, at = excluded.at',
          [input.ent, JSON.stringify(input), clock.now().toISOString()]);
        // The platform keeps a copy of the names for its list. An empty name keeps the old one.
        if (input.name !== '') await q('update enterprises set name = ?2 where id = ?1', [input.ent, input.name]);
        if (input.nameAr !== '') await q('update enterprises set name_ar = ?2 where id = ?1', [input.ent, input.nameAr]);
      });
    },

    async meter({ ent, day, counts }: { ent: EnterpriseId; day: string; counts: DayCounts }): Promise<CapAnswer> {
      entOf(ent);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ApiError('invalid_input', 'The day is YYYY-MM-DD.');
      await db.statement('write',
        'insert into account_day (day, ent, requests, rows_read, rows_written, mails) values (?1, ?2, ?3, ?4, ?5, ?6) '
        + 'on conflict (day, ent) do update set requests = excluded.requests, rows_read = excluded.rows_read, rows_written = excluded.rows_written, mails = excluded.mails',
        [day, ent, count(counts.requests), count(counts.rowsRead), count(counts.rowsWritten), count(counts.mails)]);
      // The day cap rule (plan C, design 5.14): the answer for this enterprise, with the totals of the account for the day.
      const { account } = await sums(day);
      return capVerdict({ ent, plan: planOf(), own: counts, account, writes: true });
    },

    async capState({ day }) {
      return accountStop(planOf(), (await sums(day)).account);
    },

    async meterToday({ day }) {
      return sums(day);
    },

    async mailReserve(input) {
      // The pool of the account (plan D). The limit is the mails of the Free plan, the share is the part of an enterprise except ENT_VADO.
      const plan = planOf();
      return db.tx('write', (q) => mailReserve(q, input, { limit: plan.limits.mails, share: plan.share }));
    },

    async register({ row, emails, keepExisting }: { row: EnterpriseRow; emails: string[]; keepExisting?: boolean }) {
      entOf(row.id);
      const keys = [...new Set(emails.map(normalizeEmail))];
      await db.tx('write', async (q) => {
        // Check every email first: a conflict leaves no row behind.
        for (const key of keys) {
          const [found] = await q<{ ent: string }>('select ent from emails where email = ?1', [key]);
          if (found && found.ent !== row.id) throw CONFLICT;
        }
        const [other] = await q<{ id: string }>('select id from enterprises where address = ?1 and id <> ?2', [row.address, row.id]);
        if (other) throw new ApiError('conflict', 'This address name is taken.', { reason: 'address_taken' });
        // keepExisting (the move script of VADO, run again): a row that is there stays as it is, so a later pause, limit or new name survives.
        const onConflict = keepExisting === true
          ? 'on conflict (id) do nothing'
          : 'on conflict (id) do update set address = excluded.address, state = excluded.state, name = excluded.name, name_ar = excluded.name_ar, '
            + 'limits = excluded.limits, first_admin = excluded.first_admin';
        await q(
          `insert into enterprises (id, address, state, name, name_ar, limits, created_at, first_admin) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ${onConflict}`,
          [row.id, row.address, row.state, row.name, row.nameAr, JSON.stringify(row.limits), row.createdAt, JSON.stringify(row.firstAdmin)]);
        for (const key of keys) await q('insert into emails (email, ent) values (?1, ?2) on conflict (email) do nothing', [key, row.id]);
      });
    },

    async hitAddress({ step, address }): Promise<AddressAnswer> {
      const one = ADDRESS_STEP_LIMITS[step];
      if (!one || typeof address !== 'string') throw new ApiError('invalid_input', 'This is not a step with an address limit.');
      const { prefix, ...window } = one;
      const hit = await hitLimit(statementQuery(db, 'write'), { key: await hashedKey(prefix, limitAddress(address)), ...window, now: clock.now() });
      return hit.ok ? { ok: true } : { ok: false, retryAfterMs: hit.retryAfterMs };
    },

    async refuseSignin({ signin, input }): Promise<OpResult<unknown>> {
      return runSigninOp({ db, clock, log, config, keys: NO_KEYS, ent: REFUSE_PLACEHOLDER, knownKey }, signin as SigninOpName, input as OpInput<SigninOpName>);
    },

    async refuseMail(input: Omit<OfficeMailInput, 'ent'>): Promise<OfficeMailAnswer> {
      // The limits count here as in the object. The value of the mail work is dropped: the platform sends no mail.
      const { status, body } = await runMailRoute(depsForRefuse, input);
      return { status, body };
    },

    async sweep({ at }) {
      const before = new Date(Date.parse(at) - RATE_LIMIT_KEEP_MS).toISOString();
      // The old rate limits, and the sign-in memory of the platform accounts (review 2026-11-10), in one transaction.
      await db.tx('write', async (q) => {
        await q(RATE_LIMITS_CLEANUP_LITE, [before]);
        await cleanupPlatformMemory(q, new Date(at));
      });
    },

    async health() {
      return { schema: PLATFORM_SCHEMA_VERSION };
    },

    platformSignIn: (input) => outcomeOf(() => platformSignIn(accountDeps, input)),
    platformRefresh: (input) => outcomeOf(() => platformRefresh(accountDeps, input)),
    platformSignOut: (input) => platformSignOut(accountDeps, input),
    platformAccount: (input) => platformAccount(accountDeps, input),
    platformAccounts: (input) => outcomeOf(() => platformAccounts(accountDeps, input)),

    list: () => listEnterprises(db),
    getEnterprise: async ({ ent }) => getEnterprise(db, entOf(ent)),
    create: (input) => createEnterprise(db, input, clock.now()),
    activate: ({ ent }) => activateEnterprise(db, ent),
    update: ({ ent, patch }) => updateEnterprise(db, ent, patch),
    setState: ({ ent, state }) => setEnterpriseState(db, ent, state),
    activeIds: () => activeEnterpriseIds(db),
  };
}

