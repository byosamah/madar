import type { OpResult } from '../../auth/own/office';
import type { OfficeMailAnswer, OfficeMailInput } from '../../office/parts';
import type { EnterpriseId } from '../ids';
import type { DayCounts, EnterpriseRow, EnterpriseStatus } from '../types';

/** The answer of the day cap (design 5.14). Plan C fills the rule; plan B always allows. */
export type CapAnswer = { allowed: boolean; reason?: 'busy' };

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
  isOwner(input: { ent: EnterpriseId; userId: string }): Promise<boolean>;
  /** Ops secret only. Replaces the owner list. */
  setOwners(input: { owners: { ent: EnterpriseId; userId: string }[] }): Promise<void>;
  /** The Cron of each object sends its status row. */
  report(input: EnterpriseStatus): Promise<void>;
  /** Stores the whole day so far for (ent, day) and replaces the old value, so a repeat adds nothing. */
  meter(input: { ent: EnterpriseId; day: string; counts: DayCounts }): Promise<CapAnswer>;
  /** Plan D replaces this reserve of the account mail pool. */
  mailReserve(input: { ent: EnterpriseId; kind: 'signin' | 'notice'; day: string }): Promise<'ok' | 'full'>;
  /** Ops secret only. Upserts a row in any state and reserves its emails. */
  register(input: { row: EnterpriseRow; emails: string[] }): Promise<void>;
  /** Unknown input: runs the real sign-in step on empty tables, so the answer and the time match a wrong credential. */
  refuseSignin(input: { signin: 'auth.password' | 'auth.verify' | 'auth.refresh'; input: unknown }): Promise<OpResult<unknown>>;
  refuseMail(input: Omit<OfficeMailInput, 'ent'>): Promise<OfficeMailAnswer>;
  /** The daily cleanup of the rate limit rows. */
  sweep(input: { at: string }): Promise<void>;
  health(): Promise<{ schema: number }>;
};
