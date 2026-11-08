import { describe, expect, it } from 'vitest';
import { usageAllowed, VADO_ENTERPRISE } from './enterprise';

describe('usageAllowed', () => {
  it('allows VADOs Companies only', () => {
    expect(usageAllowed(VADO_ENTERPRISE)).toBe(true);
    expect(usageAllowed('ent_001')).toBe(true);
    for (const other of ['ent_002', 'ent_0001', 'ENT_001', 'ent_001 ', '', 'vados']) expect(usageAllowed(other), other).toBe(false);
  });

  it('fails closed for an unknown enterprise', () => {
    expect(usageAllowed(null)).toBe(false);
    expect(usageAllowed(undefined)).toBe(false);
  });
});
