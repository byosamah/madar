import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { aiSwitchOf } from './aiSwitches';
import { MCP_ALLOW } from './tools';

/**
 * Project files in a chat and the file limits (fbk_070, owner 2026-10-27). An agent sends project files into a chat with chats.send and
 * fileIds, with the rights of its person, and needs the AI switch "AI sends messages" (ai.messages). files.uploadContent stays at 10 MB:
 * the 500 MB of a project file and the 250 MB of a chat file are for the screens, which send the file straight to the store.
 */
const filesLine = () => INSTRUCTIONS.split('\n').find((text) => text.startsWith('Files:'))!;
const messagesLine = () => INSTRUCTIONS.split('\n').find((text) => text.startsWith('Messages:'))!;

describe('the MCP words of project files in a chat', () => {
  it('chats.send says that fileIds may name project files that the person may share', () => {
    const text = TOOL_DOCS['chats.send'].description;
    for (const word of ['fileIds', 'project files', 'may share']) expect(text, word).toContain(word);
  });

  it('the Files and Messages lines name the rule, the switch and the limits', () => {
    expect(messagesLine()).toContain('project files that your person may share');
    expect(messagesLine()).toContain('files.list');
    expect(messagesLine()).toContain('at most 10');
    expect(messagesLine()).toContain('must be on the project');
    expect(messagesLine()).toContain('in words your person approves');
    expect(messagesLine()).toContain('ai.messages');
    expect(filesLine()).toContain('500 MB');
    expect(filesLine()).toContain('250 MB');
    expect(filesLine()).toContain('10 MB');
  });

  it('files.uploadContent keeps 10 MB', () => {
    expect(TOOL_DOCS['files.uploadContent'].description).toContain('10 MB decoded at most');
  });

  it('chats.send stays an allowed tool behind the one AI switch ai.messages', () => {
    expect(MCP_ALLOW).toContain('chats.send');
    expect(aiSwitchOf('chats.send')).toBe('ai.messages');
  });

  it('writes no em-dash and no en-dash', () => {
    for (const text of [TOOL_DOCS['chats.send'].description, filesLine(), messagesLine()]) expect(text).not.toMatch(/[–—]/);
  });
});
