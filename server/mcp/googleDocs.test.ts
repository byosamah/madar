import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from './docs';
import { MCP_ADMIN, MCP_ALLOW, MCP_DENY, mcpTools } from './tools';

/** The agent side of the Google Calendar connect (fbk_022, owner 2026-10-19): no tool, one paragraph of instructions. */
const CALLS = ['google.status', 'google.connectStart', 'google.connect', 'google.disconnect'] as const;

describe('the agent docs of Google Calendar (fbk_022)', () => {
  it('keeps the four google calls on the deny list, and on no other list', () => {
    for (const name of CALLS) {
      expect(MCP_DENY as readonly string[], name).toContain(name);
      expect(MCP_ALLOW as readonly string[], name).not.toContain(name);
      expect(MCP_ADMIN as readonly string[], name).not.toContain(name);
    }
  });

  it('gives no tool of a google call to any agent, also the agent of an Admin', () => {
    for (const admin of [false, true]) expect(mcpTools({ admin }).map((tool) => tool.name).filter((name) => name.startsWith('google.'))).toEqual([]);
  });

  it('has a Google Calendar paragraph (the Daftra paragraph follows it, owner 2026-10-26): the person connects, the agent cannot, and Google gets the title, the time and the place only', () => {
    const paragraphs = INSTRUCTIONS.split('\n').filter((text) => text !== '');
    const line = paragraphs.find((text) => text.startsWith('Google Calendar:'));
    expect(line).toBeDefined();
    expect(paragraphs[paragraphs.length - 2]).toBe(line);
    expect(paragraphs[paragraphs.length - 1]).toMatch(/^Daftra:/);
    for (const word of ['Settings screen', 'cannot connect, disconnect or read a connection', 'own Google Calendar', 'title, the time and the place only']) expect(line, word).toContain(word);
  });
});
