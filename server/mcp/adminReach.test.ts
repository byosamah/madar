import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_DENY } from './tools';

/**
 * What reaches the Admin (owner, 2026-10-23). The agent of an Admin follows the choice of its person in chats.list, and it cannot change
 * the choice: the calls that save a preference stay on the deny list.
 */
describe('the MCP side of "What reaches me"', () => {
  it('keeps the calls that save a preference away from agents', () => {
    expect(MCP_DENY).toEqual(expect.arrayContaining(['me.updatePreferences', 'notifications.updateSettings']));
    expect(MCP_ALLOW as readonly string[]).not.toContain('me.updatePreferences');
  });

  it('tells the agent in the instructions and in chats.list that the list follows the choice of its person', () => {
    expect(INSTRUCTIONS).toContain('chats.list follows the choice of your person');
    expect(INSTRUCTIONS).toContain('Only my work');
    expect(INSTRUCTIONS).toContain('Everything');
    expect(INSTRUCTIONS).toContain('You cannot change that choice');
    expect(TOOL_DOCS['chats.list'].description).toContain('Settings can change this');
  });
});

describe('the MCP side of the project lists under "Only my work" (owner, 2026-10-26, fbk_065)', () => {
  it('says that Only my work changes the screens, and that projects.list follows the filter of the agent', () => {
    expect(INSTRUCTIONS).toContain('Only my work also changes the Home and Projects screens of your person');
    expect(TOOL_DOCS['projects.list'].description).toContain('"Only my work" of an Admin does not change this list');
  });
});
