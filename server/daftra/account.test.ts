import { describe, expect, it } from 'vitest';
import { DAFTRA_ACCOUNT_PATTERN, accountNameOf, accountOfProject } from './account';
import { DAFTRA_NAME_SOURCE, DAFTRA_VAR_PATTERN } from './config';

describe('accountNameOf (the account of a sub-company)', () => {
  it('writes the English name in capitals', () => {
    expect(accountNameOf('MAZJ')).toBe('MAZJ');
    expect(accountNameOf('Vado')).toBe('VADO');
    expect(accountNameOf('Bunah')).toBe('BUNAH');
    expect(accountNameOf('Tuba')).toBe('TUBA');
    expect(accountNameOf('Zuraa')).toBe('ZURAA');
  });

  it('takes out every character that is not A to Z or 0 to 9', () => {
    expect(accountNameOf('Al Noor Design')).toBe('ALNOORDESIGN');
    expect(accountNameOf('  mazj. ')).toBe('MAZJ');
    expect(accountNameOf('Studio-2 (KSA)')).toBe('STUDIO2KSA');
    // Arabic letters and accents are not A to Z.
    expect(accountNameOf('مزج Mazj')).toBe('MAZJ');
    expect(accountNameOf('Café Zuraa')).toBe('CAFZURAA');
  });

  it('gives no account for a name that cannot be an account name', () => {
    for (const name of ['', '   ', 'A', '1Abc', 'مزج', '-- --', 'A'.repeat(21)]) expect(accountNameOf(name), name).toBeUndefined();
    expect(accountNameOf('A'.repeat(20))).toBe('A'.repeat(20));
    expect(accountNameOf('Ab')).toBe('AB');
  });

  it('gives only names that the contract pattern accepts', () => {
    for (const name of ['MAZJ', 'Vado', 'Al Noor', 'x9']) {
      const account = accountNameOf(name);
      if (account !== undefined) expect(DAFTRA_ACCOUNT_PATTERN.test(account)).toBe(true);
    }
  });

  it('keeps the pattern of the secret names equal to the pattern of the account names', () => {
    expect(DAFTRA_ACCOUNT_PATTERN.source).toBe(`^${DAFTRA_NAME_SOURCE}$`);
    expect(DAFTRA_VAR_PATTERN.test('DAFTRA_MAZJ_KEY')).toBe(true);
  });
});

describe('accountOfProject', () => {
  const subs = { sub_001: { name: 'MAZJ' }, sub_002: { name: 'Vado' }, sub_003: { name: 'Studio X' } };
  const configured = ['MAZJ', 'VADO'];

  it('gives the account of the sub-company of the project', () => {
    expect(accountOfProject({ subCompanyId: 'sub_001' }, subs, configured)).toEqual({ account: 'MAZJ', noAccount: null });
    expect(accountOfProject({ subCompanyId: 'sub_002' }, subs, new Set(configured))).toEqual({ account: 'VADO', noAccount: null });
  });

  it('says no_sub_company for a project with no sub-company, null, a missing field, or an id that is gone', () => {
    for (const project of [{}, { subCompanyId: null }, { subCompanyId: 'sub_404' }]) {
      expect(accountOfProject(project, subs, configured)).toEqual({ account: null, noAccount: 'no_sub_company' });
    }
  });

  it('says no_daftra_account for a sub-company that has no configured account, and for a copy with no account', () => {
    expect(accountOfProject({ subCompanyId: 'sub_003' }, subs, configured)).toEqual({ account: null, noAccount: 'no_daftra_account' });
    expect(accountOfProject({ subCompanyId: 'sub_001' }, subs, [])).toEqual({ account: null, noAccount: 'no_daftra_account' });
  });
});
