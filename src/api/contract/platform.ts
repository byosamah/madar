import { z } from 'zod';
import { PICTURE_DATA } from './limits';

/**
 * The platform calls of Madar enterprises (design 5.6). They are not shared calls of an office: they run in the Worker and the platform
 * object, after the platform token check, and `can()` never sees them. The route is POST /api/platform. The page "Madar
 * enterprises" is the only screen that calls them. `EnterpriseView` holds no project, task, chat, file or person data, except the name and
 * the email of the first Admin of an enterprise that the owner created.
 */

export const PLATFORM_CALL_NAMES = [
  'platform.me', 'platform.enterprises.list', 'platform.enterprises.create', 'platform.enterprises.update',
  'platform.enterprises.pause', 'platform.enterprises.resume', 'platform.enterprises.resendInvite', 'platform.meter.get',
] as const;
export type PlatformCallName = (typeof PLATFORM_CALL_NAMES)[number];

/** The same rule as ADDRESS_NAME of server/enterprise/ids.ts. The contract may not import the server, so a test pins the two sources. */
export const ADDRESS_NAME_RULE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

/** A picture of an enterprise logo: 24,000 characters at most, as the logo of a sub-company. */
const LOGO_MAX = 24_000;
const Logo = z.string().max(LOGO_MAX).regex(PICTURE_DATA, 'Expected picture data of a WebP, JPEG or PNG picture.');

const Name = z.string().trim().min(1).max(80);
const Address = z.string().regex(ADDRESS_NAME_RULE, 'Use 3 to 32 lower case letters, digits and hyphens.');
const EnterpriseId = z.string().regex(/^ent_\d{3,}$/);

export const EnterpriseLimitsIn = z.object({
  people: z.number().int().min(1).nullable(),
  storageBytes: z.number().int().min(1).nullable(),
});

const EnterpriseState = z.enum(['creating', 'active', 'paused']);
const DayCountsOut = z.object({ requests: z.number(), rowsRead: z.number(), rowsWritten: z.number(), mails: z.number() });
const LimitsOut = z.object({ people: z.number().nullable(), storageBytes: z.number().nullable() });

/** One row of the list. A pin (platform.test.ts) holds the 14 keys: a new key here needs a decision about person data. */
export const EnterpriseView = z.object({
  id: EnterpriseId,
  address: z.string(),
  name: z.string(),
  nameAr: z.string(),
  logo: z.string().nullable(),
  state: EnterpriseState,
  limits: LimitsOut,
  people: z.number(),
  invited: z.number(),
  storageBytes: z.number(),
  lastWriteAt: z.string().nullable(),
  createdAt: z.string(),
  firstAdmin: z.object({ name: z.string(), email: z.string() }).nullable(),
});
export type EnterpriseView = z.infer<typeof EnterpriseView>;

const PlanLimitsOut = z.object({ requests: z.number(), rowsRead: z.number(), rowsWritten: z.number(), mails: z.number() });

export const platformContracts = {
  'platform.me': {
    input: z.object({}),
    output: z.object({ createOpen: z.boolean() }),
  },
  'platform.enterprises.list': { input: z.object({}), output: z.array(EnterpriseView) },
  'platform.enterprises.create': {
    input: z.object({
      name: Name,
      nameAr: Name,
      address: Address,
      logo: Logo.nullable().optional(),
      limits: EnterpriseLimitsIn,
      admin: z.object({ name: Name, email: z.string().trim().min(3).max(254).email(), language: z.enum(['en', 'ar']) }),
    }),
    output: EnterpriseView,
  },
  'platform.enterprises.update': {
    input: z.object({
      id: EnterpriseId,
      patch: z.object({
        name: Name.optional(),
        nameAr: Name.optional(),
        logo: Logo.nullable().optional(),
        limits: EnterpriseLimitsIn.partial().optional(),
      }).strict(),
    }),
    output: EnterpriseView,
  },
  'platform.enterprises.pause': { input: z.object({ id: EnterpriseId, confirmName: z.string().max(200) }), output: EnterpriseView },
  'platform.enterprises.resume': { input: z.object({ id: EnterpriseId }), output: EnterpriseView },
  'platform.enterprises.resendInvite': { input: z.object({ id: EnterpriseId }), output: z.object({ sentAt: z.string() }) },
  'platform.meter.get': {
    input: z.object({}),
    output: z.object({
      day: z.string(),
      limits: PlanLimitsOut,
      total: DayCountsOut,
      share: z.number(),
      warn: z.array(z.string()),
      stop: z.boolean(),
      enterprises: z.array(z.object({ id: EnterpriseId, name: z.string(), nameAr: z.string(), day: DayCountsOut })),
    }),
  },
} satisfies Record<PlatformCallName, { input: z.ZodType; output: z.ZodType }>;

export type PlatformApi = {
  [N in PlatformCallName]: (input: z.input<(typeof platformContracts)[N]['input']>) => Promise<z.output<(typeof platformContracts)[N]['output']>>;
};
