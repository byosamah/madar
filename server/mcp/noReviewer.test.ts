import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';

// tsk_692 (owner, 2026-11-08): a move to In review that nobody else could review is refused with the reason no_reviewer.
describe('the MCP words of the refused move to In review', () => {
  it('names the reason and the way out in the tool text and in the instructions', () => {
    expect(TOOL_DOCS['tasks.move'].description).toContain('no_reviewer');
    expect(TOOL_DOCS['tasks.move'].description).toContain('use done');
    expect(INSTRUCTIONS).toContain('no_reviewer');
  });
});
