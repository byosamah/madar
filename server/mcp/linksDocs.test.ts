import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from './docs';

describe('the agent docs of the links of a project (owner, 2026-10-19)', () => {
  it('tell the agent where the links are, and the three calls that add, change and remove one (MCP parity, owner 2026-10-26)', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Links:'));
    expect(line).toBeDefined();
    for (const word of ['projects.get', 'Files & Links', 'projects.addLink', 'projects.updateLink', 'projects.removeLink']) expect(line, word).toContain(word);
    expect(line).not.toContain('cannot add or change a link');
  });

  it('keep the Files line to the files', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Files:'));
    expect(line).toBeDefined();
    expect(line).not.toContain('Links');
  });
});
