import { describe, expect, it } from 'vitest';
import { Payment } from './entities';

const old = {
  id: 'pay_001', projectId: 'prj_001', name: 'Second payment', amount: 12500, dueDate: '2026-10-26', receivedOn: null, note: '',
  createdBy: 'usr_001', createdAt: '2026-10-01T09:00:00.000+03:00',
};
const daftra = {
  account: 'MAZJ', invoiceId: '1521945', invoiceNo: '000123', total: 12500, issuedOn: '2026-10-26', linkedBy: 'usr_002', linkedAt: '2026-10-26T10:00:00.000+03:00',
};

describe('Payment.daftra (the Daftra link, owner, 2026-10-26)', () => {
  it('still parses an old row that has no daftra field, and adds none', () => {
    const parsed = Payment.parse(old);
    expect(parsed).toEqual(old);
    expect('daftra' in parsed).toBe(false);
  });

  it('parses a row with the link and keeps every field of it', () => {
    expect(Payment.parse({ ...old, daftra }).daftra).toEqual(daftra);
  });

  it('refuses a link that lacks a field, or holds a wrong value', () => {
    for (const key of Object.keys(daftra)) {
      const { [key as keyof typeof daftra]: _gone, ...rest } = daftra;
      expect(Payment.safeParse({ ...old, daftra: rest }).success, key).toBe(false);
    }
    expect(Payment.safeParse({ ...old, daftra: { ...daftra, issuedOn: '26/10/2026' } }).success).toBe(false);
    expect(Payment.safeParse({ ...old, daftra: { ...daftra, linkedBy: 'user_1' } }).success).toBe(false);
    expect(Payment.safeParse({ ...old, daftra: { ...daftra, invoiceId: '' } }).success).toBe(false);
    expect(Payment.safeParse({ ...old, daftra: { ...daftra, total: -1 } }).success).toBe(false);
    // The account is a name in capitals, A to Z and 0 to 9 (the section Accounts of the spec).
    for (const bad of ['mazj', 'M', 'MA ZJ', 'MAZJ-2', '1MAZJ', 'A'.repeat(21), '']) {
      expect(Payment.safeParse({ ...old, daftra: { ...daftra, account: bad } }).success, bad).toBe(false);
    }
    expect(Payment.safeParse({ ...old, daftra: { ...daftra, account: 'BUNAH2' } }).success).toBe(true);
  });
});
