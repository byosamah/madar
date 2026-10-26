import { halalasOfRiyals } from './parse';

/**
 * The suggestion rule of the payment sheet (the Daftra link, owner 2026-10-26). Pure: no clock, no database, no network.
 *
 * The invoices of the matched client, not a draft, not held by another payment, with the total equal to the payment amount in whole
 * halalas, and made on or after the due day of the payment minus 60 days. The newest wins. A different amount never suggests.
 */

/** The days before the due day that an invoice may be made and still match. */
export const SUGGEST_BACK_DAYS = 60;

export type CachedInvoice = {
  id: string;
  no: string;
  totalHalalas: number;
  /** `YYYY-MM-DD`. */
  issuedOn: string;
  /** An ISO stamp: the `created` of Daftra. */
  createdAt: string;
  paymentStatus: number;
  paidOn: string | null;
  draft: boolean;
};

export type SuggestInput = {
  /** The payment amount in riyals, with VAT. */
  amount: number;
  /** The due day, `YYYY-MM-DD`. */
  dueDate: string;
  invoices: readonly CachedInvoice[];
  /** The Daftra invoice ids that other payments hold. */
  taken: ReadonlySet<string>;
};

/** `YYYY-MM-DD` minus `days`. */
export function dayMinus(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Newest first: by `createdAt`, then by the id as a number, then as text, so the order never depends on the input order. */
export function newestFirst(a: CachedInvoice, b: CachedInvoice): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  const x = Number(a.id);
  const y = Number(b.id);
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return y - x;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The invoices that may be chosen for a payment: not a draft, not held by another payment, newest first. */
export function chooseFrom(invoices: readonly CachedInvoice[], taken: ReadonlySet<string>): CachedInvoice[] {
  return invoices.filter((invoice) => !invoice.draft && !taken.has(invoice.id)).sort(newestFirst);
}

/** The one invoice to suggest for a payment, or null. */
export function suggestInvoice(input: SuggestInput): CachedInvoice | null {
  const wanted = halalasOfRiyals(input.amount);
  const from = dayMinus(input.dueDate, SUGGEST_BACK_DAYS);
  const match = chooseFrom(input.invoices, input.taken).find((invoice) => invoice.totalHalalas === wanted && invoice.createdAt.slice(0, 10) >= from);
  return match ?? null;
}
