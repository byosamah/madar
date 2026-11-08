import type { EnterpriseId } from './ids';

/** The records of Madar enterprises (design 5.6 to 5.9). */
export type EnterpriseState = 'creating' | 'active' | 'paused';
export type EnterpriseLimits = { people: number | null; storageBytes: number | null }; // null: no limit
export type EnterpriseRow = {
  id: EnterpriseId; address: string; name: string; nameAr: string; state: EnterpriseState;
  limits: EnterpriseLimits; createdAt: string; firstAdmin: { name: string; email: string };
};
export type DayCounts = { requests: number; rowsRead: number; rowsWritten: number; mails: number };
export type EnterpriseStatus = {
  ent: EnterpriseId; people: number; invited: number; storageBytes: number; lastWriteAt: string | null; day: DayCounts;
  name: string; nameAr: string;
};

/** The input of the first start of an enterprise object (plan C, Task 5). codePrefix: the project code head, from the address name. */
export type EnterpriseInit = {
  ent: EnterpriseId; address: string; name: string; nameAr: string; logo: string | null;
  limits: EnterpriseLimits; codePrefix: string; admin: { name: string; email: string; language: 'en' | 'ar' };
};
