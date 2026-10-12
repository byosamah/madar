import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { mcpTools } from './tools';

/**
 * Feedback fbk_003 (2026-10-12): a person may keep a project code outside the office pattern after a warning. An agent gets the
 * refusal (reason code_format or code_taken), asks its person, and calls again with codeAnyway: true. The same day the Tracker type
 * "balady" became Government on the screens (owner): any government body, not only the Balady portal. The value stays "balady".
 */
describe('the agent side of a kept project code and of the Government tracker type', () => {
  it('gives projects.update a codeAnyway switch, and the docs say to ask the person first', () => {
    const update = mcpTools().find((tool) => tool.name === 'projects.update')!;
    expect((update.inputSchema.properties as Record<string, unknown>).codeAnyway).toMatchObject({ type: 'boolean' });
    expect(TOOL_DOCS['projects.update'].description).toContain('codeAnyway');
    expect(TOOL_DOCS['projects.update'].description).toContain('code_format');
    expect(INSTRUCTIONS).toContain('codeAnyway');
  });

  it('names balady as any government body in the tracker docs', () => {
    expect(TOOL_DOCS['tracker.log'].description).toContain('balady (any government body');
    expect(TOOL_DOCS['tracker.list'].description).toContain('government steps');
  });
});
