import { describe, expect, it } from 'vitest';
import { sameText } from './sameText';

describe('sameText', () => {
  it('takes two names as the same with other spaces at the ends and another case', () => {
    expect(sameText('Permits', '  permits ')).toBe(true);
    expect(sameText('Construction Documents', 'CONSTRUCTION DOCUMENTS')).toBe(true);
  });

  it('keeps different names apart', () => {
    expect(sameText('Permits', 'Permit')).toBe(false);
    expect(sameText('Design Development', 'Design  Development')).toBe(false);
  });
});
