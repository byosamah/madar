import { describe, expect, it } from 'vitest';
import { VADO_ENTERPRISE } from '../../src/lib/enterprise';
import { ENT_VADO } from './ids';

describe('the enterprise rules of the screens', () => {
  it('names VADOs Companies with the id of the server', () => {
    expect(VADO_ENTERPRISE).toBe(ENT_VADO);
  });
});
