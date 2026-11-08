import type { output } from 'zod';
import { invalidInput } from './client';
import {
  PLATFORM_CALL_NAMES, platformContracts, type EnterpriseView, type PlatformApi, type PlatformCallName,
} from './contract/platform';
import { ApiError, invalid } from './errors';
import type { DirectoryHandle, FakeDirectory, FakeEnterprise } from './fakeDirectory';
import { VADO_ENTERPRISE } from './vadoEnterprise';

/**
 * The prototype side of the platform calls (Madar enterprises, design 5.19). `fakePlatform` is the closed fallback: every call answers
 * not_found, as the real route does for a person who is no platform owner. The prototype runtime puts `platformApiOf(createPlatformFake(...))`
 * in its place (src/app/bootstrap.ts). The fake follows the rules of the server, and it reads and writes only the fake directory: it takes no
 * store, so it can touch no state of an office.
 */
const refuse = (): Promise<never> => Promise.reject(new ApiError('not_found', 'This address does not exist.'));

export const fakePlatform: PlatformApi = Object.fromEntries(PLATFORM_CALL_NAMES.map((name) => [name, refuse])) as unknown as PlatformApi;

/** The words that no address name may be (RESERVED_ADDRESSES of server/enterprise/ids.ts; a test pins the two lists). */
export const RESERVED_FAKE_ADDRESSES: readonly string[] = ['oauth', 'oauth-protected-resource', 'mcp', 'api', 'platform', 'admin', 'www'];

/** The numbers of the Free plan that the meter shows (PLAN_LIMITS of server/enterprise/plan.ts). */
const FREE_LIMITS = { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000, mails: 100 };
const SHARE = 0.1;
const DAY_VADO = { requests: 8_000, rowsRead: 400_000, rowsWritten: 5_000, mails: 10 };
const DAY_OTHER = { requests: 400, rowsRead: 20_000, rowsWritten: 100, mails: 2 };

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const viewOf = (row: FakeEnterprise, directory: FakeDirectory): EnterpriseView => {
  const { emails: _emails, ...view } = row;
  return { ...view, hasOwner: directory.owners.some((owner) => owner.ent === row.id) };
};

export type PlatformFakeOptions = {
  /** True in the mode "Platform owner" of Preview as. Without the mode every call answers not_found, as for a person who is no owner. */
  ownerMode?: () => boolean;
};

export function createPlatformFake(
  dir: DirectoryHandle, now: () => Date, options: PlatformFakeOptions = {},
): (name: PlatformCallName, input: unknown) => Promise<unknown> {
  const ownerMode = options.ownerMode ?? (() => false);

  const save = async (directory: FakeDirectory, id: string): Promise<EnterpriseView> => {
    await dir.write(directory);
    const row = directory.enterprises.find((one) => one.id === id);
    if (!row) throw new ApiError('not_found', 'This address does not exist.');
    return platformContracts['platform.enterprises.list'].output.parse([viewOf(row, directory)])[0];
  };
  const find = (directory: FakeDirectory, id: string): FakeEnterprise => {
    const row = directory.enterprises.find((one) => one.id === id);
    if (!row) throw new ApiError('not_found', 'This address does not exist.');
    return row;
  };
  const edit = (id: string, change: (row: FakeEnterprise, directory: FakeDirectory) => void): Promise<EnterpriseView> => {
    const directory = structuredClone(dir.read());
    change(find(directory, id), directory);
    return save(directory, id);
  };

  const handlers: { [N in PlatformCallName]: (input: ParsedInput<N>) => Promise<unknown> } = {
    'platform.me': async () => ({ owner: true as const, ent: dir.read().owners[0]?.ent ?? VADO_ENTERPRISE, createOpen: true }),
    'platform.enterprises.list': async () => {
      const directory = dir.read();
      return directory.enterprises.map((row) => viewOf(row, directory));
    },
    'platform.enterprises.create': async (input) => {
      const directory = structuredClone(dir.read());
      if (RESERVED_FAKE_ADDRESSES.includes(input.address) || directory.enterprises.some((row) => row.address === input.address)) {
        throw invalid('address', 'This address name is taken.', 'address_taken');
      }
      const email = normalizeEmail(input.admin.email);
      // The refusal names no other enterprise: it says only that the email is in use.
      if (directory.enterprises.some((row) => row.emails.includes(email))) throw invalid('admin.email', 'This email is already in use.', 'email_taken');
      const next = Math.max(0, ...directory.enterprises.map((row) => Number(row.id.slice(4)))) + 1;
      const id = `ent_${String(next).padStart(3, '0')}`;
      directory.enterprises.push({
        id, address: input.address, name: input.name, nameAr: input.nameAr, logo: input.logo ?? null, state: 'active',
        limits: input.limits, people: 0, invited: 1, storageBytes: 0, lastWriteAt: null, createdAt: now().toISOString(),
        firstAdmin: { name: input.admin.name, email }, hasOwner: false, emails: [email],
      });
      return save(directory, id);
    },
    'platform.enterprises.update': async (input) => edit(input.id, (row) => {
      if (row.state === 'creating') throw new ApiError('conflict', 'Finish creating this enterprise first.', { reason: 'not_finished' });
      if (row.state === 'paused') throw new ApiError('forbidden', 'Madar is paused for this company.', { reason: 'enterprise_paused' });
      const { patch } = input;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.nameAr !== undefined) row.nameAr = patch.nameAr;
      if (patch.logo !== undefined) row.logo = patch.logo;
      if (patch.limits?.people !== undefined) row.limits.people = patch.limits.people;
      if (patch.limits?.storageBytes !== undefined) row.limits.storageBytes = patch.limits.storageBytes;
    }),
    'platform.enterprises.pause': async (input) => edit(input.id, (row, directory) => {
      if (row.state === 'creating') throw new ApiError('conflict', 'Finish creating this enterprise first.', { reason: 'not_finished' });
      if (directory.owners.some((owner) => owner.ent === row.id)) {
        throw new ApiError('forbidden', 'You cannot pause an enterprise that holds a platform owner.', { reason: 'owner_enterprise' });
      }
      const typed = input.confirmName.trim();
      if (typed === '' || (typed !== row.name.trim() && typed !== row.nameAr.trim())) throw invalid('confirmName', 'The name does not match.', 'name_mismatch');
      row.state = 'paused';
    }),
    'platform.enterprises.resume': async (input) => edit(input.id, (row) => {
      if (row.state === 'creating') throw new ApiError('conflict', 'Finish creating this enterprise first.', { reason: 'not_finished' });
      row.state = 'active';
    }),
    'platform.enterprises.resendInvite': async (input) => {
      const row = find(dir.read(), input.id);
      if (row.state === 'creating') throw new ApiError('conflict', 'Finish creating this enterprise first.', { reason: 'not_finished' });
      if (row.invited < 1) throw new ApiError('conflict', 'This person accepted the invitation already.', { reason: 'already_accepted' });
      return { sentAt: now().toISOString() };
    },
    'platform.meter.get': async () => {
      const rows = dir.read().enterprises.map((row) => ({ id: row.id, name: row.name, nameAr: row.nameAr, day: row.id === VADO_ENTERPRISE ? DAY_VADO : DAY_OTHER }));
      const total = { requests: 0, rowsRead: 0, rowsWritten: 0, mails: 0 };
      for (const row of rows) for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += row.day[key];
      return { day: now().toISOString().slice(0, 10), limits: FREE_LIMITS, total, share: SHARE, warn: [], stop: false, enterprises: rows };
    },
  };

  return async (name, input) => {
    // An unknown name and a person who is no owner get the same answer, as the real route gives.
    if (!(PLATFORM_CALL_NAMES as readonly string[]).includes(name) || !ownerMode()) throw new ApiError('not_found', 'This address does not exist.');
    const contract = platformContracts[name];
    const parsed = contract.input.safeParse(input);
    if (!parsed.success) throw invalidInput(parsed.error);
    const out = await (handlers[name] as (value: unknown) => Promise<unknown>)(parsed.data);
    return contract.output.parse(out);
  };
}

type ParsedInput<N extends PlatformCallName> = output<(typeof platformContracts)[N]['input']>;

/** The fake as the object that the screens call: one method for each platform call. */
export function platformApiOf(fake: (name: PlatformCallName, input: unknown) => Promise<unknown>): PlatformApi {
  return Object.fromEntries(PLATFORM_CALL_NAMES.map((name) => [name, (input: unknown) => fake(name, input)])) as unknown as PlatformApi;
}
