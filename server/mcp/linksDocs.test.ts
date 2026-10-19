import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from './docs';

describe('the agent docs of the links of a project (owner, 2026-10-19)', () => {
  it('tell the agent where the links are, and that a person adds them in the Files & Links tab', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Links:'));
    expect(line).toBeDefined();
    for (const word of ['projects.get', 'Files & Links', 'cannot add or change a link']) expect(line, word).toContain(word);
  });

  it('keep the Files line to the files', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Files:'));
    expect(line).toBeDefined();
    expect(line).not.toContain('Links');
  });
});
