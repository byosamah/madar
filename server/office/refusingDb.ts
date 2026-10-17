import type { Db } from '../core/ports';

const REFUSED = 'The Worker has no database on the office path: the office object holds it (server/office/office.ts).';

/** The Db of the Worker on the office path. Only a wiring mistake reaches it, so every statement fails with a clear message. */
export const refusingDb: Db = {
  tx: () => Promise.reject(new Error(REFUSED)),
  savepoint: () => Promise.reject(new Error(REFUSED)),
  statement: () => Promise.reject(new Error(REFUSED)),
};
