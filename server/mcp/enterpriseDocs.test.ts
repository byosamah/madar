import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from './docs';

describe('the words of the MCP server for an enterprise (Madar enterprises)', () => {
  it('INSTRUCTIONS says that an agent acts for one person of one company and cannot see or change other companies', () => {
    expect(INSTRUCTIONS).toContain('You act for one person of one company');
    expect(INSTRUCTIONS).toContain('You cannot see or change other companies.');
  });
});
