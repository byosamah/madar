import { describe, expect, it } from 'vitest';
import { linkedProjectCodes, segmentsOf } from './text';

describe('project links by the new key (item 6b)', () => {
  it('links #260902AZT as it links #KH-26-014', () => {
    expect(segmentsOf('See #260902AZT and #KH-26-014.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'project', code: '260902AZT' },
      { kind: 'text', text: ' and ' },
      { kind: 'project', code: 'KH-26-014' },
      { kind: 'text', text: '.' },
    ]);
    expect(linkedProjectCodes('#260902AZT, #261011ABCD and #KH-26-014')).toEqual(['260902AZT', '261011ABCD', 'KH-26-014']);
  });

  it('links the key at the start of a full code, and keeps the rest as text', () => {
    expect(segmentsOf('#260902AZT-RES-Villa')).toEqual([{ kind: 'project', code: '260902AZT' }, { kind: 'text', text: '-RES-Villa' }]);
  });

  it('does not link a wrong month, too few or too many letters, or a key inside a word', () => {
    for (const body of ['#261302AZT', '#260902AZ', '#260902AZTXY', 'x#260902AZTx']) {
      expect(segmentsOf(body).some((segment) => segment.kind === 'project')).toBe(false);
    }
  });
});
