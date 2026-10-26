import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BadAnswer, clientAnswerOf, clientsAnswerOf, halalasOf, halalasOfRiyals, invoiceAnswerOf, invoiceOf, invoicesAnswerOf } from './parse';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('the list form of an invoice (strings and ISO dates)', () => {
  const list = invoicesAnswerOf(fixture('invoices-list.json'));

  it('reads every invoice of the sample list', () => {
    expect(list.map((i) => i.id)).toEqual(['1830', '1829', '1828']);
    expect(list[0]).toEqual({
      id: '1830', no: '1521945', clientId: '842', totalHalalas: 26087, issuedOn: '2026-10-04', createdAt: '2026-10-04T21:39:53.000Z',
      paymentStatus: 2, paidOn: null, draft: false,
    });
  });

  it('takes the total from summary_total and never compares summary_paid with it (860.87 paid on a 260.87 invoice)', () => {
    expect(list[0].totalHalalas).toBe(26087);
  });
});

describe('the single form of an invoice (numbers and the date form of the account)', () => {
  const one = invoiceAnswerOf(fixture('invoice-single.json'));

  it('reads numbers, and takes issuedOn from created because the date is not ISO', () => {
    expect(one).toEqual({
      id: '1862', no: '1521960', clientId: '823', totalHalalas: 16652, issuedOn: '2026-10-21', createdAt: '2026-10-21T16:23:52.000Z',
      paymentStatus: 2, paidOn: '2026-09-29', draft: false,
    });
  });

  it('takes paidOn from the newest payment row, in any order', () => {
    const raw = {
      id: '1', no: '1', client_id: '2', summary_total: '10', payment_status: 1, draft: '0', created: '2026-10-21 10:00:00',
      InvoicePayment: [{ date: '2026-10-02 00:00:00' }, { date: '2026-10-09 00:00:00' }, { date: '2026-10-05 00:00:00' }],
    };
    expect(invoiceOf(raw).paidOn).toBe('2026-10-09');
  });

  it('gives paidOn null when there is no payment row or no row has a date', () => {
    const base = { id: '1', no: '1', client_id: '2', summary_total: '10', payment_status: 0, draft: '0', created: '2026-10-21 10:00:00' };
    expect(invoiceOf({ ...base, InvoicePayment: [] }).paidOn).toBeNull();
    expect(invoiceOf({ ...base, InvoicePayment: [{ date: '29/09/2026' }, { amount: '1' }] }).paidOn).toBeNull();
    expect(invoiceOf(base).paidOn).toBeNull();
  });

  it('reads draft as 1, "1" or true', () => {
    const base = { id: '1', no: '1', client_id: '2', summary_total: 5, payment_status: 0, created: '2026-10-21 10:00:00' };
    for (const draft of [1, '1', true]) expect(invoiceOf({ ...base, draft }).draft).toBe(true);
    for (const draft of [0, '0', false, undefined]) expect(invoiceOf({ ...base, draft }).draft).toBe(false);
  });

  it('keeps an ISO date of the single form as it is', () => {
    const raw = { id: '1', no: '1', client_id: '2', summary_total: 5, payment_status: 0, draft: 0, created: '2026-10-21 10:00:00', date: '2026-09-29' };
    expect(invoiceOf(raw).issuedOn).toBe('2026-09-29');
  });
});

describe('whole halalas', () => {
  it('reads strings and numbers with up to 4 decimals', () => {
    expect(halalasOf('166.52')).toBe(16652);
    expect(halalasOf(166.52)).toBe(16652);
    expect(halalasOf('283.9465')).toBe(28395);
    expect(halalasOf('0')).toBe(0);
    expect(halalasOf('12500.0000')).toBe(1_250_000);
  });

  it('refuses a value that is no amount', () => {
    for (const bad of ['', 'abc', null, undefined, -1, NaN, {}]) expect(() => halalasOf(bad)).toThrow(BadAnswer);
  });

  it('turns a riyal amount of Madar into the same halalas as the Daftra string', () => {
    for (const amount of [12500, 166.52, 0.1 + 0.2, 1234.56, 99999.99]) expect(halalasOfRiyals(amount)).toBe(halalasOf(amount.toFixed(2)));
  });
});

describe('clients', () => {
  it('reads the sample list: the business name and the number', () => {
    expect(clientsAnswerOf(fixture('clients-list.json'))).toEqual([
      { id: '763', name: 'Client 1', number: '760' },
      { id: '334', name: 'Client 2', number: '328' },
      { id: '535', name: 'Client 3', number: '530' },
    ]);
  });

  it('falls back to the first and last name of a person', () => {
    const body = { data: { Client: { id: '9', client_number: '5', business_name: '', first_name: 'Sara', last_name: 'Ali' } } };
    expect(clientAnswerOf(body)).toEqual({ id: '9', name: 'Sara Ali', number: '5' });
  });

  it('refuses a client with no name', () => {
    expect(() => clientAnswerOf({ data: { Client: { id: '9', business_name: '' } } })).toThrow(BadAnswer);
  });
});

describe('a wrong shape', () => {
  it('gives bad_answer and never a part of the answer', () => {
    for (const body of [null, 'x', {}, { data: 5 }, { data: [{ Nope: 1 }] }, { data: [{ Invoice: { id: '1', secret: 'SECRET-TEXT' } }] }]) {
      try {
        invoicesAnswerOf(body);
        throw new Error('no refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(BadAnswer);
        expect(String((error as Error).message)).toBe('bad_answer');
      }
    }
  });

  it('refuses an invoice with no created stamp, a bad status or a bad total', () => {
    const ok = { id: '1', no: '1', client_id: '2', summary_total: '10', payment_status: 0, draft: 0, created: '2026-10-21 10:00:00' };
    expect(() => invoiceOf(ok)).not.toThrow();
    expect(() => invoiceOf({ ...ok, created: undefined })).toThrow(BadAnswer);
    expect(() => invoiceOf({ ...ok, created: '2026-13-40 10:00:00' })).toThrow(BadAnswer);
    expect(() => invoiceOf({ ...ok, payment_status: 'paid' })).toThrow(BadAnswer);
    expect(() => invoiceOf({ ...ok, summary_total: 'x' })).toThrow(BadAnswer);
  });
});
