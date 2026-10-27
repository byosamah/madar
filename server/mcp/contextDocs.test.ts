import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from './docs';
import { MCP_ALLOW, MCP_BY_RIGHT } from './tools';

/**
 * The context rule (owner, 2026-10-27): the answer to a question about a project or a to-do is often in a chat, not in the record.
 * So the agent reads the chats before it answers. A client can show only the start of the instructions: Claude Code cut the Madar
 * instructions at about 4,100 characters (2026-10-27), and an agent that only reads never calls madar.readFirst. So the rule sits
 * near the top.
 */
const SHOWN_START = 4000;

const contextLine = (): string => {
  const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Context:'));
  expect(line).toBeDefined();
  return line!;
};

describe('the context rule of the agent instructions (owner, 2026-10-27)', () => {
  it('tells the agent to read the chats of a project or a to-do before it answers about it', () => {
    const line = contextLine();
    for (const word of ['often', 'before you answer', 'summary', 'projects.get', 'chatId', 'chats.messages', 'before', 'updates.list',
      'comments.list', 'targetType task', 'search.query', 'which chat', 'ai.readChats']) expect(line, word).toContain(word);
  });

  it('sits in the start of the instructions that a client shows before it cuts the text', () => {
    const line = contextLine();
    expect(INSTRUCTIONS.indexOf(line) + line.length).toBeLessThan(SHOWN_START);
  });

  it('names only tools that an agent can get', () => {
    const tools = new Set<string>([...MCP_ALLOW, ...Object.keys(MCP_BY_RIGHT)]);
    // A name with the head "ai." is an AI switch, not a tool.
    const named = (contextLine().match(/\b[a-z]+\.[a-z][A-Za-z]+\b/g) ?? []).filter((name) => !name.startsWith('ai.'));
    expect(named.length).toBeGreaterThan(4);
    for (const name of named) expect(tools.has(name), name).toBe(true);
  });
});
