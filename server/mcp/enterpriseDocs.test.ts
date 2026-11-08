import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from './docs';

describe('the words of the MCP server for an enterprise (Madar enterprises)', () => {
  it('INSTRUCTIONS holds "one person of one enterprise"', () => {
    expect(INSTRUCTIONS).toContain('one person of one enterprise');
  });
});
