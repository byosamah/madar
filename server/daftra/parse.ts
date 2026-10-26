/**
 * The answers of Daftra, as plain values (the Daftra link, owner 2026-10-26; proof.md, "Daftra study on the Mazj account").
 *
 * Daftra gives the same invoice in two forms. The list gives strings and ISO dates (`2026-10-04`). The single invoice gives numbers and the
 * date form of the account (`29/09/2026`). This file reads both. Money becomes whole halalas, because Daftra gives up to 4 decimals.
 * A parse error says only `bad_answer`: it never holds a text of the answer.
 */

export type DaftraInvoice = {
  id: string;
  no: string;
  /** The Daftra client id. */
  clientId: string;
  /** The total with VAT (`summary_total`) in whole halalas. */
  totalHalalas: number;
  /** The day of the invoice as `YYYY-MM-DD`. From `date` in the list form, from `created` when `date` is not ISO. */
  issuedOn: string;
  /** The Daftra `created` as an ISO stamp. Daftra gives it without a zone, so it is read as UTC. */
  createdAt: string;
  /** Daftra `payment_status`: 0 unpaid, 1 part paid, 2 paid. */
  paymentStatus: number;
  /** The day of the last Daftra payment row. Null until paid, and always null in the list form (it has no payment rows). */
  paidOn: string | null;
  draft: boolean;
};

export type DaftraClientRow = { id: string; name: string; number: string };

export class BadAnswer extends Error {
  constructor() {
    super('bad_answer');
    this.name = 'BadAnswer';
  }
}

/** Whole halalas of an amount that Daftra gives as a string or a number. Never compare `summary_paid` with the total. */
export function halalasOf(amount: unknown): number {
  const value = typeof amount === 'number' ? amount : typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : NaN;
  if (!Number.isFinite(value) || value < 0) throw new BadAnswer();
  return Math.round(value * 100);
}

/** Whole halalas of a riyal amount of Madar. */
export const halalasOfRiyals = (riyals: number): number => Math.round(riyals * 100);

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_STAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const text = (value: unknown, max = 200): string => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new BadAnswer();
  return value.trim();
};

const isDay = (value: string): boolean => {
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
};

/** The ISO stamp of a Daftra stamp (`YYYY-MM-DD HH:MM:SS`). */
function stampOf(value: unknown): string {
  const match = typeof value === 'string' ? ISO_STAMP.exec(value.trim()) : null;
  if (!match || !isDay(match[1])) throw new BadAnswer();
  return `${match[1]}T${match[2]}.000Z`;
}

const flag = (value: unknown): boolean => value === true || value === 1 || value === '1';

const status = (value: unknown): number => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isInteger(number)) throw new BadAnswer();
  return number;
};

/** The day of the last payment row: the newest `date` that has the ISO form. Null when no row has one. */
function paidOnOf(payments: unknown): string | null {
  if (!Array.isArray(payments)) return null;
  let last: string | null = null;
  for (const row of payments) {
    const date = record(row)?.date;
    const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?$/.test(date.trim()) ? date.trim().slice(0, 10) : null;
    if (day !== null && isDay(day) && (last === null || day > last)) last = day;
  }
  return last;
}

/** One invoice object: the `Invoice` part of a list item or of the single answer. */
export function invoiceOf(raw: unknown): DaftraInvoice {
  const row = record(raw);
  if (!row) throw new BadAnswer();
  const createdAt = stampOf(row.created);
  const date = typeof row.date === 'string' ? row.date.trim() : '';
  const issuedOn = isDay(date) ? date : createdAt.slice(0, 10);
  return {
    id: text(row.id, 40),
    no: text(row.no, 40),
    clientId: text(row.client_id, 40),
    totalHalalas: halalasOf(row.summary_total),
    issuedOn,
    createdAt,
    paymentStatus: status(row.payment_status),
    paidOn: paidOnOf(row.InvoicePayment),
    draft: flag(row.draft),
  };
}

/** The answer of `GET /invoices/<id>.json`. */
export function invoiceAnswerOf(body: unknown): DaftraInvoice {
  return invoiceOf(record(record(body)?.data)?.Invoice);
}

/**
 * The rows of a list that read well. One odd row is left out, so it never fails the whole list (code review, 2026-10-26). A list where every row
 * is odd still fails with bad_answer: that is the sign that Daftra changed the shape of its answer. An empty list is a list.
 */
function goodRows<T>(data: unknown[], read: (item: unknown) => T): T[] {
  const rows: T[] = [];
  for (const item of data) {
    try {
      rows.push(read(item));
    } catch (error) {
      if (!(error instanceof BadAnswer)) throw error;
    }
  }
  if (data.length > 0 && rows.length === 0) throw new BadAnswer();
  return rows;
}

/** The answer of `GET /invoices.json`. */
export function invoicesAnswerOf(body: unknown): DaftraInvoice[] {
  const data = record(body)?.data;
  if (!Array.isArray(data)) throw new BadAnswer();
  return goodRows(data, (item) => invoiceOf(record(item)?.Invoice));
}

/** The name of a client: the business name, else the first and last name. */
function clientOf(raw: unknown): DaftraClientRow {
  const row = record(raw);
  if (!row) throw new BadAnswer();
  const business = typeof row.business_name === 'string' ? row.business_name.trim() : '';
  const person = [row.first_name, row.last_name].filter((part): part is string => typeof part === 'string' && part.trim() !== '').map((part) => part.trim()).join(' ');
  const name = business !== '' ? business : person;
  if (name === '') throw new BadAnswer();
  // No number, or an empty one, is no number (code review, 2026-10-26).
  const blank = row.client_number === undefined || row.client_number === null || (typeof row.client_number === 'string' && row.client_number.trim() === '');
  return { id: text(row.id, 40), name: name.slice(0, 200), number: blank ? '' : text(row.client_number, 40) };
}

/** The answer of `GET /clients.json`. */
export function clientsAnswerOf(body: unknown): DaftraClientRow[] {
  const data = record(body)?.data;
  if (!Array.isArray(data)) throw new BadAnswer();
  return goodRows(data, (item) => clientOf(record(item)?.Client));
}

/** The answer of `GET /clients/<id>.json`. */
export function clientAnswerOf(body: unknown): DaftraClientRow {
  return clientOf(record(record(body)?.data)?.Client);
}
