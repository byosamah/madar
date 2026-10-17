import { describe, expect, it } from 'vitest';
import { NEW_SECRET_NAMES, newSecretArgs, withSecretLine } from './new-secret';

describe('a new secret line (scripts/office/new-secret.ts)', () => {
  it('adds the line at the end, and refuses a name that is there already', () => {
    expect(withSecretLine('A=1', 'MADAR_OPS_SECRET', 'x')).toBe('A=1\nMADAR_OPS_SECRET=x\n');
    expect(withSecretLine('', 'MADAR_OPS_SECRET', 'x')).toBe('MADAR_OPS_SECRET=x\n');
    expect(withSecretLine('A=1\n\n', 'MADAR_OPS_SECRET', 'x')).toBe('A=1\nMADAR_OPS_SECRET=x\n');
    expect(() => withSecretLine('MADAR_OPS_SECRET=y\n', 'MADAR_OPS_SECRET', 'x')).toThrow('is in the file already');
    expect(() => withSecretLine('B=1\nMADAR_OPS_SECRET=leaky-value-1\n', 'MADAR_OPS_SECRET', 'x')).not.toThrow('leaky-value-1');
    expect(NEW_SECRET_NAMES).toEqual(['MADAR_OPS_SECRET', 'MADAR_EXPORT_SECRET']);
  });

  it('takes the test copy only, one of the two names, and the GitHub secret of the export only', () => {
    expect(newSecretArgs(['test', 'MADAR_OPS_SECRET'])).toEqual({ target: 'test', name: 'MADAR_OPS_SECRET' });
    expect(newSecretArgs(['test', 'MADAR_EXPORT_SECRET', '--github', 'OFFICE_EXPORT_SECRET'])).toEqual({ target: 'test', name: 'MADAR_EXPORT_SECRET', github: 'OFFICE_EXPORT_SECRET' });
    expect(() => newSecretArgs(['production', 'MADAR_OPS_SECRET'])).toThrow('wave 6');
    expect(() => newSecretArgs(['test', 'JOBS_SECRET'])).toThrow('must be one of');
    expect(() => newSecretArgs(['test', 'MADAR_OPS_SECRET', '--github', 'OFFICE_EXPORT_SECRET'])).toThrow('goes only to');
    expect(() => newSecretArgs(['test', 'MADAR_EXPORT_SECRET', '--github', 'OTHER'])).toThrow('goes only to the GitHub secret OFFICE_EXPORT_SECRET');
  });
});
