import type { OpResult } from '../../auth/own/office';
import type { OfficeMailAnswer, OfficeMailInput } from '../../office/parts';
import type { EnterpriseId } from '../ids';
import type { PlatformAccountsInput, PlatformAccountView, PlatformOutcome, PlatformTokenAnswer } from './accounts';
import type { DayCounts, EnterpriseLimits, EnterpriseRow, EnterpriseStatus } from '../types';

/** The answer of the day cap (design 5.14). Plan C fills the rule; plan B always allows. */
export type CapAnswer = { allowed: boolean; reason?: 'busy' };

/** One row of the platform list: the record, the logo, and the last status row of its Cron (null before the first report). */
export type EnterpriseListRow = EnterpriseRow & { logo: string | null; status: EnterpriseStatus | null };
/** The input of the platform call create, as the platform object stores it. */
export type CreateRowInput = {
  name: string; nameAr: string; address: string; logo: string | null; limits: EnterpriseLimits; admin: { name: string; email: string };
};
export type CreateRowAnswer = { ok: true; row: EnterpriseRow; fresh: boolean } | { ok: false; refused: 'address_taken' | 'email_taken' };

/** The steps that run before a token and choose the enterprise by an email or a tag. Each one has a limit for the network address. */
export type AddressStep = 'auth.password' | 'auth.verify' | 'forgot' | 'renew';
export type AddressAnswer = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * The RPC methods of the platform object that the Worker calls (Madar enterprises, design 5.1). The first group is the contract; plan C
 * adds list, create, update, setState, resendInvite and meterToday. The platform object holds no record of an enterprise.
 */
export type PlatformStub = {
  resolveEmail(input: { email: string }): Promise<{ ent: EnterpriseId } | null>; // the email is normalized by the caller
  resolveAddress(input: { address: string }): Promise<{ ent: EnterpriseId } | null>;
  /** The ids with state active or paused. An enterprise in state creating is never listed. */
  listed(): Promise<EnterpriseId[]>;
  reserveEmail(input: { ent: EnterpriseId; email: string }): Promise<'ok' | 'taken'>;
  releaseEmail(input: { ent: EnterpriseId; email: string }): Promise<void>;
  /** The Cron of each object sends its status row. */
  report(input: EnterpriseStatus): Promise<void>;
  /** Stores the whole day so far for (ent, day) and replaces the old value, so a repeat adds nothing. */
  meter(input: { ent: EnterpriseId; day: string; counts: DayCounts }): Promise<CapAnswer>;
  /** The account at the stop line for a UTC day (design 5.14). The Worker keeps the answer for 60 seconds. */
  capState(input: { day: string }): Promise<{ stop: boolean; writesStop: boolean }>;
  /** The day counts of the account and of each enterprise, for the meter strip of the platform page. */
  meterToday(input: { day: string }): Promise<{ account: DayCounts; byEnterprise: { ent: EnterpriseId; counts: DayCounts }[] }>;
  /** A place in the mail pool of the account (plan D). The ref is the scoped idempotency key of the mail: a repeat of a ref takes no new place. */
  mailReserve(input: { ent: EnterpriseId; kind: 'signin' | 'notice'; day: string; ref: string }): Promise<'ok' | 'full'>;
  /** Ops secret only. Upserts a row in any state and reserves its emails. With keepExisting a row that is there stays as it is. */
  register(input: { row: EnterpriseRow; emails: string[]; keepExisting?: boolean }): Promise<void>;
  /**
   * Counts one hit of the network address for a step, before the Worker chooses the enterprise (design 5.2). It is the only count of the
   * address for these steps: the enterprise objects and the refuse steps get addressChecked and skip their own. The limits of the email
   * and of the key stay in the object of the enterprise.
   */
  hitAddress(input: { step: AddressStep; address: string }): Promise<AddressAnswer>;
  /** Unknown input: runs the real sign-in step on empty tables, so the answer and the time match a wrong credential. */
  refuseSignin(input: { signin: 'auth.password' | 'auth.verify' | 'auth.refresh'; input: unknown }): Promise<OpResult<unknown>>;
  refuseMail(input: Omit<OfficeMailInput, 'ent'>): Promise<OfficeMailAnswer>;
  /** The daily cleanup of the rate limit rows. */
  sweep(input: { at: string }): Promise<void>;
  health(): Promise<{ schema: number }>;
  /** The calls of the platform page (plan C). The platform object holds no record of an enterprise: these are the rows of its own list. */
  list(): Promise<EnterpriseListRow[]>;
  getEnterprise(input: { ent: EnterpriseId }): Promise<EnterpriseListRow | null>;
  /** One transaction: the next id, the address and the first Admin email. A repeat of the same input returns the same row with fresh false. */
  create(input: CreateRowInput): Promise<CreateRowAnswer>;
  /** creating to active only. */
  activate(input: { ent: EnterpriseId }): Promise<void>;
  update(input: { ent: EnterpriseId; patch: { name?: string; nameAr?: string; logo?: string | null; limits?: EnterpriseLimits } }): Promise<void>;
  /** active or paused. A creating row refuses with not_finished. */
  setState(input: { ent: EnterpriseId; state: 'active' | 'paused' }): Promise<void>;
  /** The ids in state active: the Cron fan-out reads this list, so a paused enterprise gets no job. */
  activeIds(): Promise<EnterpriseId[]>;
  /**
   * The accounts of the platform (plan F, design D8). They belong to no company. A wrong password and an unknown email give one answer.
   * The tokens have the audience madar-platform and no ent. A method that can refuse returns the refusal as data (PlatformOutcome): a thrown
   * ApiError loses its class on the way over the RPC hop of a Durable Object.
   */
  platformSignIn(input: { email: string; password: string; address: string }): Promise<PlatformOutcome<PlatformTokenAnswer>>;
  platformRefresh(input: { refreshToken: string }): Promise<PlatformOutcome<PlatformTokenAnswer>>;
  platformSignOut(input: { sessionId: string }): Promise<void>;
  platformAccount(input: { accountId: string }): Promise<PlatformAccountView | null>;
  /** Ops secret only (design D13): create, set a new password, turn off or on. */
  platformAccounts(input: PlatformAccountsInput): Promise<PlatformOutcome<PlatformAccountView>>;
};
