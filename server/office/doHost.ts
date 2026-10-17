import type { DurableObjectStorage } from 'cloudflare:workers';
import { NESTED_TRANSACTION, hostValues, refuseLiteStatement, type SqlHost, type SqlRow } from '../data/lite/host';

/**
 * The SQL host of the office object (Supabase exit, wave 1): ctx.storage.sql with the refusal guard of node:sqlite, and the
 * transaction of Task 1 of the exit plan (an async closure whose awaits are all on exec). totals counts every row that the
 * host read or wrote, for the rows pins and, in wave 3, the day meters. When trace is a list, each statement adds its text and
 * its rows to it (the rows pins of Task 18 read it to find the statement that reads most).
 */
export type TraceLine = { text: string; rowsRead: number; rowsWritten: number };
export type DoHost = SqlHost & { readonly totals: { rowsRead: number; rowsWritten: number }; trace: TraceLine[] | undefined };

export function doHost(storage: DurableObjectStorage): DoHost {
  let open = false;
  const totals = { rowsRead: 0, rowsWritten: 0 };
  const host: DoHost = {
    counts: true,
    totals,
    trace: undefined,
    exec(text, values) {
      refuseLiteStatement(text, values);
      // The office object binds a JS boolean as the text 'true' (proof.md, wave 1 Task 1), so it gets 1 or 0, as on node:sqlite.
      const cursor = storage.sql.exec(text, ...hostValues(values));
      const rows = cursor.toArray() as SqlRow[];
      totals.rowsRead += cursor.rowsRead;
      totals.rowsWritten += cursor.rowsWritten;
      host.trace?.push({ text: text.slice(0, 200), rowsRead: cursor.rowsRead, rowsWritten: cursor.rowsWritten });
      return { rows, rowsRead: cursor.rowsRead, rowsWritten: cursor.rowsWritten };
    },
    async transaction(work) {
      if (open) throw new Error(NESTED_TRANSACTION);
      open = true;
      try {
        return await storage.transaction(() => work());
      } finally {
        open = false;
      }
    },
    size: () => storage.sql.databaseSize,
  };
  return host;
}
