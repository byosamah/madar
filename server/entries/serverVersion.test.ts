import { describe, expect, it } from 'vitest';
import { releaseVersion } from '../../vite.server.config';

// Owner, 2026-10-12: the MCP server said version "1.0.0" in every release, and claude.ai kept the tool list of that version, so
// the new message tools never showed. The build now names each release by the number of commits: "1.0.<count>".
describe('the release version of the server bundle', () => {
  it('is 1.0 and the number of commits, so each commit gives a higher version', () => {
    expect(releaseVersion(() => '512\n')).toBe('1.0.512');
    expect(releaseVersion(() => '513')).toBe('1.0.513');
  });

  it('falls back to 1.0.0 when git gives no count or fails', () => {
    expect(releaseVersion(() => '')).toBe('1.0.0');
    expect(releaseVersion(() => 'fatal: not a git repository')).toBe('1.0.0');
    expect(releaseVersion(() => { throw new Error('no git'); })).toBe('1.0.0');
  });
});
