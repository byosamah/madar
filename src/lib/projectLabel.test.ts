import { describe, expect, it } from 'vitest';
import { shownCode, shownKey } from './projectLabel';

const t = (key: string) => (key === 'project.internal' ? 'Internal' : key);

describe('the key and the code that a screen shows', () => {
  it('shows the key of a client project, as before', () => {
    expect(shownKey('260902AZT-RES-Villa', t as never)).toBe('260902AZT');
    expect(shownKey({ code: 'KH-26-014' }, t as never)).toBe('KH-26-014');
    expect(shownCode({ code: '260902AZT-RES-Villa', kind: 'client' }, t as never)).toBe('260902AZT-RES-Villa');
  });

  it('shows the word Internal for an internal project, never its INT code', () => {
    expect(shownKey({ code: 'INT-26-001', kind: 'internal' }, t as never)).toBe('Internal');
    expect(shownCode({ code: 'INT-26-001', kind: 'internal' }, t as never)).toBe('Internal');
  });

  it('knows an internal code that comes with no kind, as a task or a file of a list carries it', () => {
    expect(shownKey('INT-26-014', t as never)).toBe('Internal');
    expect(shownKey({ code: 'INT-26-014' }, t as never)).toBe('Internal');
    expect(shownKey('INT-26', t as never)).toBe('INT-26');
    expect(shownKey('KH-26-014', t as never)).toBe('KH-26-014');
  });
});
