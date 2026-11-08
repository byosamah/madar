import type { z } from 'zod';
import type { EnterpriseView, platformContracts } from '../../../src/api/contract/platform';
import { ApiError, invalid } from '../../../src/api/errors';
import type { Logger } from '../../core/ports';
import type { OfficeStub } from '../../entries/officeWorker';
import type { NetApi } from '../../office/net';
import { testToolsOn } from '../../office/ops';
import type { EnterpriseId } from '../ids';
import { codePrefixOf } from '../lifecycle';
import type { EnterpriseListRow, PlatformStub } from './stub';

/**
 * The platform calls (Madar enterprises, design 5.6), as the Worker runs them after the token check and the owner check. They reach an
 * enterprise object only through the RPC methods init, setState, setLimits, setIdentity and reinvite. In a change of two sides, the
 * object comes first and the platform row second, so a failed second step leaves the object as the owner wanted and a repeat is harmless.
 */

export type PlatformCtx = {
  /** The caller: a platform owner, an active person of this enterprise. */
  ent: EnterpriseId;
  userId: string;
  platform: PlatformStub;
  office(ent: EnterpriseId): OfficeStub;
  net(): NetApi;
  read(name: string): string | undefined;
  now(): Date;
  log: Logger;
};

type CreateInput = z.output<(typeof platformContracts)['platform.enterprises.create']['input']>;
export type EnterpriseViewOut = z.output<typeof EnterpriseView>;

/**
 * One row of the list, as the page sees it. firstAdmin is null when the record holds no name and no email. hasOwner is true when the
 * owner list names a person of this enterprise.
 */
export function viewOf(row: EnterpriseListRow, hasOwner = false): EnterpriseViewOut {
  const { name, email } = row.firstAdmin;
  return {
    id: row.id, address: row.address, name: row.name, nameAr: row.nameAr, logo: row.logo, state: row.state, limits: row.limits,
    people: row.status?.people ?? 0, invited: row.status?.invited ?? 0, storageBytes: row.status?.storageBytes ?? 0,
    lastWriteAt: row.status?.lastWriteAt ?? null, createdAt: row.createdAt,
    firstAdmin: name === '' && email === '' ? null : { name, email }, hasOwner,
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
  }, ctx.net());
  if (!init.ok) {
    if ('error' in init) throw refusalOf(init.error);
    throw new ApiError('failed', 'The enterprise did not start. Try again.');
  }
  await ctx.platform.activate({ ent });
  const row = await ctx.platform.getEnterprise({ ent });
  if (!row) throw new ApiError('failed', 'The enterprise did not save. Try again.');
  return viewOf(row);
}
