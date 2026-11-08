import { describe, expect, it } from 'vitest';
import { ENT_VADO, ENTERPRISE_ID, isAddressName, isEnterpriseId, normalizeEmail, PLATFORM_OBJECT, RESERVED_ADDRESSES, tagged, untag, VADO_ADDRESS } from './ids';

describe('isEnterpriseId', () => {
  it('accepts ent_001 and ent_1234', () => {
    expect(isEnterpriseId('ent_001')).toBe(true);
    expect(isEnterpriseId('ent_1234')).toBe(true);
    expect(ENTERPRISE_ID.test('ent_002')).toBe(true);
  });

  it('refuses ent_01, ENT_001, a leading space, a tail, a number and null', () => {
    for (const bad of ['ent_01', 'ENT_001', ' ent_001', 'ent_001x', 'ent_001\n', 42, null, undefined, {}]) expect(isEnterpriseId(bad)).toBe(false);
  });
});

describe('tagged and untag', () => {
  it('reads back what it wrote', () => {
    expect(untag(tagged('ent_002', 'abc_DEF-123'))).toEqual({ ent: 'ent_002', secret: 'abc_DEF-123' });
    expect(tagged('ent_002', 'abc')).toBe('ent_002.abc');
  });

  it('gives null for an untagged text, an empty secret, a wrong id, two dots and a text of 5,000 characters', () => {
    for (const bad of ['abc', 'ent_001.', 'ENT_001.abc', 'ent_001.a.b', 'ent_01.abc', 'ent_001.' + 'a'.repeat(5000), 'a'.repeat(5000), 'ent_001.a b', '']) {
      expect(untag(bad)).toBeNull();
    }
  });

  it('accepts a secret of 300 characters and refuses one of 301', () => {
    expect(untag(`ent_001.${'a'.repeat(300)}`)).not.toBeNull();
    expect(untag(`ent_001.${'a'.repeat(301)}`)).toBeNull();
  });
});

describe('address names', () => {
  it('accepts vados and refuses a reserved word, capitals and bad edges', () => {
    expect(isAddressName('vados')).toBe(true);
    expect(isAddressName('globex-2')).toBe(true);
    for (const bad of ['oauth', 'Vados', 'a', 'a-', '-ab', 'mcp', 'api', 'platform', 'admin', 'www', 'a'.repeat(33), 5, null]) expect(isAddressName(bad)).toBe(false);
    expect(RESERVED_ADDRESSES).toContain('oauth');
  });
});

describe('the constants and the email rule', () => {
  it('normalizes an email', () => {
    expect(normalizeEmail('  Admin@Madar.TEST ')).toBe('admin@madar.test');
  });

  it('names VADOs Companies and the platform object', () => {
    expect([ENT_VADO, VADO_ADDRESS, PLATFORM_OBJECT]).toEqual(['ent_001', 'vados', 'platform']);
  });
});
