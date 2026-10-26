import { describe, expect, it } from 'vitest';
import { chooseFrom, dayMinus, suggestInvoice, type CachedInvoice } from './suggest';

const inv = (over: Partial<CachedInvoice> & { id: string }): CachedInvoice => ({
  no: `N${over.id}`, totalHalalas: 1_250_000, issuedOn: '2026-10-20', createdAt: '2026-10-20T10:00:00.000Z', paymentStatus: 0, paidOn: null, draft: false, ...over,
});
const DUE = '2026-10-26';
const base = { amount: 12_500, dueDate: DUE, taken: new Set<string>() };

describe('the suggestion rule', () => {
  it('suggests the invoice with the same amount in whole halalas', () => {
    expect(suggestInvoice({ ...base, invoices: [inv({ id: '1' })] })?.id).toBe('1');
  });

  it('compares halalas, so a float amount still matches', () => {
    const found = suggestInvoice({ ...base, amount: 166.52, invoices: [inv({ id: '1', totalHalalas: 16652 })] });
    expect(found?.id).toBe('1');
  });

  it('never suggests a different amount, not even by one halala', () => {
    expect(suggestInvoice({ ...base, invoices: [inv({ id: '1', totalHalalas: 1_250_001 }), inv({ id: '2', totalHalalas: 1_249_999 })] })).toBeNull();
  });

  it('leaves out a draft', () => {
    expect(suggestInvoice({ ...base, invoices: [inv({ id: '1', draft: true })] })).toBeNull();
  });

  it('leaves out an invoice that another payment holds', () => {
    expect(suggestInvoice({ ...base, taken: new Set(['1']), invoices: [inv({ id: '1' })] })).toBeNull();
    expect(suggestInvoice({ ...base, taken: new Set(['1']), invoices: [inv({ id: '1' }), inv({ id: '2' })] })?.id).toBe('2');
  });

  it('takes the newest of several matches, whatever the input order', () => {
    const a = inv({ id: '10', createdAt: '2026-10-10T09:00:00.000Z' });
    const b = inv({ id: '11', createdAt: '2026-10-22T09:00:00.000Z' });
    const c = inv({ id: '12', createdAt: '2026-10-15T09:00:00.000Z' });
    expect(suggestInvoice({ ...base, invoices: [a, b, c] })?.id).toBe('11');
    expect(suggestInvoice({ ...base, invoices: [c, b, a] })?.id).toBe('11');
  });

  it('breaks a tie of the stamp by the higher id', () => {
    const a = inv({ id: '9' });
    const b = inv({ id: '100' });
    expect(suggestInvoice({ ...base, invoices: [a, b] })?.id).toBe('100');
  });

  it('accepts an invoice made exactly 60 days before the due day, and refuses one made 61 days before', () => {
    expect(dayMinus(DUE, 60)).toBe('2026-08-27');
    expect(suggestInvoice({ ...base, invoices: [inv({ id: '1', createdAt: '2026-08-27T00:00:00.000Z' })] })?.id).toBe('1');
    expect(suggestInvoice({ ...base, invoices: [inv({ id: '1', createdAt: '2026-08-26T23:59:59.000Z' })] })).toBeNull();
  });

  it('accepts an invoice made after the due day', () => {
    expect(suggestInvoice({ ...base, invoices: [inv({ id: '1', createdAt: '2026-11-30T10:00:00.000Z' })] })?.id).toBe('1');
  });

  it('suggests nothing for no invoices', () => {
    expect(suggestInvoice({ ...base, invoices: [] })).toBeNull();
  });
});

describe('the list of other invoices', () => {
  it('leaves out drafts and taken invoices, newest first, and does not change the input', () => {
    const list = [inv({ id: '1', createdAt: '2026-10-01T00:00:00.000Z' }), inv({ id: '2', draft: true }), inv({ id: '3', createdAt: '2026-10-09T00:00:00.000Z' }), inv({ id: '4' })];
    const copy = [...list];
    expect(chooseFrom(list, new Set(['4'])).map((i) => i.id)).toEqual(['3', '1']);
    expect(list).toEqual(copy);
  });
});

describe('dayMinus', () => {
  it('crosses a month and a year', () => {
    expect(dayMinus('2026-01-10', 20)).toBe('2025-12-21');
    expect(dayMinus('2026-03-01', 1)).toBe('2026-02-28');
  });
});
