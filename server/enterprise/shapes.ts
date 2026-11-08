import { z } from 'zod';
import { ENTERPRISE_ID, isAddressName } from './ids';
import type { EnterpriseRow } from './types';

/**
 * The zod shapes of the records that cross a wire (Madar enterprises): the ops of the Mac write the platform list with them. The Postgres
 * path never loads this file.
 */

const COUNT_OR_NULL = z.number().int().min(0).nullable();

export const EnterpriseRowShape: z.ZodType<EnterpriseRow> = z.object({
  id: z.string().regex(ENTERPRISE_ID),
  address: z.string().refine(isAddressName, 'Use 3 to 32 lower case letters, digits and hyphens, and not a reserved word.'),
  name: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().max(120),
  state: z.enum(['creating', 'active', 'paused']),
  limits: z.object({ people: COUNT_OR_NULL, storageBytes: COUNT_OR_NULL }),
  createdAt: z.string().min(10).max(40),
  firstAdmin: z.object({ name: z.string().trim().max(120), email: z.string().trim().max(254) }),
});

export const RegisterBodyShape = z.object({ row: EnterpriseRowShape, emails: z.array(z.string().trim().min(3).max(254)).max(500) });
