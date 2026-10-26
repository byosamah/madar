import type { Deps } from '../core/ports';
import type { OfficeSnapshot } from '../core/types';
import { isLite } from '../data/dialect';
import { liteDbOf } from '../data/lite/db';
import { readLiteOffice } from '../data/lite/office';
import { readOffice } from '../data/officeCache';

/**
 * The office lists for code that runs outside a call (the preflight of payments.linkInvoice and the job step daftra): from the office cache on
 * Postgres, from the office rows on SQLite (the office object path), as the meetings step reads them. One read, no lock.
 */
export function officeOf(deps: Deps): Promise<OfficeSnapshot> {
  return isLite(deps.db) ? deps.db.tx('read', (q) => readLiteOffice(liteDbOf(q), q)) : readOffice(deps);
}
