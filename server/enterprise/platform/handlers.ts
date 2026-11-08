import type { z } from 'zod';
import type { EnterpriseView, PlatformCallName, platformContracts } from '../../../src/api/contract/platform';
import { ApiError, invalid } from '../../../src/api/errors';
import type { Logger } from '../../core/ports';
import type { OfficeStub } from '../../entries/officeWorker';
import type { NetApi } from '../../office/net';
import { testToolsOn } from '../../office/ops';
import { type EnterpriseId } from '../ids';
import { codePrefixOf } from '../lifecycle';
import { utcDay } from '../../mail/quota';
import { accountStop, planFrom, warnings } from '../plan';
import type { EnterpriseLimits } from '../types';
import type { EnterpriseListRow, PlatformStub } from './stub';

/**
 * The platform calls (Madar enterprises, design 5.6), as the Worker runs them after the token check and the owner check. They reach an
 * enterprise object only through the RPC methods init, setState, setLimits, setIdentity and reinvite. In a change of two sides, the
 * object comes first and the platform row second, so a failed second step leaves the object as the owner wanted and a repeat is harmless.
 */

export type PlatformCtx = {
  /** The caller: an active platform account (plan F). It belongs to no company. */
  accountId: string;
  platform: PlatformStub;
  office(ent: EnterpriseId): OfficeStub;
  /** The network port of the enterprise that a call works on (never the enterprise of the caller). */
  net(ent: EnterpriseId): NetApi;
  read(name: string): string | undefined;
  now(): Date;
  log: Logger;
};

type CreateInput = z.output<(typeof platformContracts)['platform.enterprises.create']['input']>;
export type EnterpriseViewOut = z.output<typeof EnterpriseView>;

/**
 * One row of the list, as the page sees it. firstAdmin is null when the record holds no name and no email.
 */
export function viewOf(row: EnterpriseListRow): EnterpriseViewOut {
  const { name, email } = row.firstAdmin;
  return {
    id: row.id, address: row.address, name: row.name, nameAr: row.nameAr, logo: row.logo, state: row.state, limits: row.limits,
    people: row.status?.people ?? 0, invited: row.status?.invited ?? 0, storageBytes: row.status?.storageBytes ?? 0,
    lastWriteAt: row.status?.lastWriteAt ?? null, createdAt: row.createdAt,
    firstAdmin: name === '' && email === '' ? null : { name, email },
  };
}

/** Production keeps the create call closed until the lead sets MADAR_ENTERPRISE_CREATE to open (design section 6, decision D5). The test tools open it too. */
export function createOpen(read: (name: string) => string | undefined): boolean {
  return read('MADAR_ENTERPRISE_CREATE') === 'open' || testToolsOn(read);
}

/** An object refusal as an ApiError, so the route answers it with the usual status and body. */
function refusalOf(error: { code: string; message: string; details?: Record<string, unknown> }): ApiError {
  return new ApiError(error.code as ApiError['code'], error.message, error.details ?? {});
}

/**
 * Create, in the order of design 5.7. Each step can run again with no harm: a failed init leaves the row in state creating, and the same
 * call again finds the row (fresh false), runs init again (it changes nothing that exists) and ends with activate.
 */
export async function createEnterprise(input: CreateInput, ctx: PlatformCtx): Promise<EnterpriseViewOut> {
  if (!createOpen(ctx.read)) throw new ApiError('forbidden', 'Creating enterprises is closed now.', { reason: 'create_closed' });
  const logo = input.logo ?? null;
  const made = await ctx.platform.create({
    name: input.name, nameAr: input.nameAr, address: input.address, logo, limits: input.limits, admin: { name: input.admin.name, email: input.admin.email },
  });
  if (!made.ok) {
    throw made.refused === 'address_taken'
      ? invalid('address', 'This address name is taken.', 'address_taken')
      : invalid('admin.email', 'This email is already in use.', 'email_taken');
  }
  const ent = made.row.id;
  const init = await ctx.office(ent).init({
    ent, address: input.address, name: input.name, nameAr: input.nameAr, logo, limits: input.limits, codePrefix: codePrefixOf(input.address),
    admin: { name: input.admin.name, email: made.row.firstAdmin.email, language: input.admin.language },
  }, ctx.net(ent));
  if (!init.ok) {
    if ('error' in init) throw refusalOf(init.error);
    throw new ApiError('failed', 'The enterprise did not start. Try again.');
  }
  await ctx.platform.activate({ ent });
  const row = await ctx.platform.getEnterprise({ ent });
  if (!row) throw new ApiError('failed', 'The enterprise did not save. Try again.');
  return viewOf(row);
}

// ---- The other calls (plan C, Task 10) ----

type Out<N extends PlatformCallName> = z.output<(typeof platformContracts)[N]['output']>;
type In<N extends PlatformCallName> = z.output<(typeof platformContracts)[N]['input']>;

async function rowOf(ctx: PlatformCtx, ent: EnterpriseId): Promise<EnterpriseListRow> {
  const row = await ctx.platform.getEnterprise({ ent });
  if (!row) throw new ApiError('not_found', 'This address does not exist.');
  return row;
}

async function viewFor(ctx: PlatformCtx, ent: EnterpriseId): Promise<EnterpriseViewOut> {
  // One call after the other: the platform object runs one transaction at a time.
  return viewOf(await rowOf(ctx, ent));
}

/** An object that did not finish its creation takes no change: the page shows Not finished, and the owner tries create again. */
function assertFinished(row: EnterpriseListRow): void {
  if (row.state === 'creating') throw new ApiError('conflict', 'Finish creating this enterprise first.', { reason: 'not_finished' });
}

/** The answer of an RPC method with an OpResult: the value, or the refusal as an ApiError. */
function valueOf<T>(out: { ok: true; value: T } | { ok: false; error?: { code: string; message: string; details?: Record<string, unknown> } }): T {
  if (out.ok) return out.value;
  if ('error' in out && out.error) throw refusalOf(out.error);
  throw new ApiError('failed', 'Something went wrong. Try again.');
}

/** The name the owner types to pause: the English name or the Arabic name of the enterprise, with the spaces around it trimmed. */
function nameMatches(row: EnterpriseListRow, typed: string): boolean {
  const text = typed.trim();
  return text !== '' && (text === row.name.trim() || text === row.nameAr.trim());
}

async function update(input: In<'platform.enterprises.update'>, ctx: PlatformCtx): Promise<Out<'platform.enterprises.update'>> {
  const row = await rowOf(ctx, input.id);
  assertFinished(row);
  if (row.state === 'paused') throw new ApiError('forbidden', 'Madar is paused for this company.', { reason: 'enterprise_paused' });
  const { patch } = input;
  // The object first. A field that is not in the patch is not sent, so a name or a logo that the Admin changed in the Office settings stays.
  const identity = {
    ...(patch.name !== undefined && patch.name !== row.name ? { name: patch.name } : {}),
    ...(patch.nameAr !== undefined && patch.nameAr !== row.nameAr ? { nameAr: patch.nameAr } : {}),
    ...(patch.logo !== undefined && patch.logo !== row.logo ? { logo: patch.logo } : {}),
  };
  if (Object.keys(identity).length > 0) await ctx.office(input.id).setIdentity({ ent: input.id, ...identity });
  let limits: EnterpriseLimits | undefined;
  if (patch.limits !== undefined) {
    limits = {
      people: patch.limits.people !== undefined ? patch.limits.people : row.limits.people,
      storageBytes: patch.limits.storageBytes !== undefined ? patch.limits.storageBytes : row.limits.storageBytes,
    };
    if (limits.people !== row.limits.people || limits.storageBytes !== row.limits.storageBytes) await ctx.office(input.id).setLimits({ ent: input.id, limits });
  }
  await ctx.platform.update({
    ent: input.id,
    patch: {
      ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.nameAr !== undefined ? { nameAr: patch.nameAr } : {}),
      ...(patch.logo !== undefined ? { logo: patch.logo } : {}), ...(limits ? { limits } : {}),
    },
  });
  return viewFor(ctx, input.id);
}

async function pause(input: In<'platform.enterprises.pause'>, ctx: PlatformCtx): Promise<Out<'platform.enterprises.pause'>> {
  const row = await rowOf(ctx, input.id);
  assertFinished(row);
  // VADO is a normal company: the platform pauses it like any other (design D11). The typed name below is the only guard.
  if (!nameMatches(row, input.confirmName)) throw invalid('confirmName', 'The name does not match.', 'name_mismatch');
  await ctx.office(input.id).setState({ ent: input.id, state: 'paused' });
  await ctx.platform.setState({ ent: input.id, state: 'paused' });
  return viewFor(ctx, input.id);
}

async function resume(input: In<'platform.enterprises.resume'>, ctx: PlatformCtx): Promise<Out<'platform.enterprises.resume'>> {
  assertFinished(await rowOf(ctx, input.id));
  await ctx.office(input.id).setState({ ent: input.id, state: 'active' });
  await ctx.platform.setState({ ent: input.id, state: 'active' });
  return viewFor(ctx, input.id);
}

async function resendInvite(input: In<'platform.enterprises.resendInvite'>, ctx: PlatformCtx): Promise<Out<'platform.enterprises.resendInvite'>> {
  assertFinished(await rowOf(ctx, input.id));
  return valueOf(await ctx.office(input.id).reinvite({ ent: input.id }, ctx.net(input.id)));
}

/** The meter strip of the page (design G8): the use of the account today, the plan limits, the warnings, and the counts of each enterprise. */
async function meterGet(_input: In<'platform.meter.get'>, ctx: PlatformCtx): Promise<Out<'platform.meter.get'>> {
  const plan = planFrom(ctx.read);
  const day = utcDay(ctx.now());
  const today = await ctx.platform.meterToday({ day });
  const stop = accountStop(plan, today.account);
  const rows = await ctx.platform.list();
  const zero = { requests: 0, rowsRead: 0, rowsWritten: 0, mails: 0 };
  const counts = new Map(today.byEnterprise.map((one) => [one.ent, one.counts]));
  return {
    day, limits: plan.limits, total: today.account, share: plan.share, warn: warnings(plan, today.account), stop: stop.stop || stop.writesStop,
    enterprises: rows.map((row) => ({ id: row.id, name: row.name, nameAr: row.nameAr, day: counts.get(row.id) ?? zero })),
  };
}

export const PLATFORM_HANDLERS: {
  [N in PlatformCallName]: (input: In<N>, ctx: PlatformCtx) => Promise<Out<N>>;
} = {
  'platform.me': async (_input, ctx) => ({ createOpen: createOpen(ctx.read) }),
  'platform.enterprises.list': async (_input, ctx) => {
    return (await ctx.platform.list()).map((row) => viewOf(row));
  },
  'platform.enterprises.create': createEnterprise,
  'platform.enterprises.update': update,
  'platform.enterprises.pause': pause,
  'platform.enterprises.resume': resume,
  'platform.enterprises.resendInvite': resendInvite,
  'platform.meter.get': meterGet,
};
