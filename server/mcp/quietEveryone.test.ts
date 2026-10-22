import { describe, expect, it } from 'vitest';
import { CATALOG_SECTIONS } from '../../src/api/rightsCatalog';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_DENY } from './tools';

/**
 * Quiet hours (fbk_048) and @everyone (fbk_041) on the MCP side (owner rule of 2026-10-05: every feature change updates the allow, deny
 * list, TOOL_DOCS and INSTRUCTIONS in the same commit).
 */
describe('the MCP side of quiet hours and @everyone', () => {
  it('says the quiet hours rule in INSTRUCTIONS: no push and no email, one push at the end, no email later', () => {
    expect(INSTRUCTIONS).toContain('Quiet hours:');
    expect(INSTRUCTIONS).toContain('no push and no email');
    expect(INSTRUCTIONS).toContain('one push');
    expect(INSTRUCTIONS).toContain('an email never comes');
    expect(INSTRUCTIONS).toContain('You cannot read or change quiet hours');
  });

  it('names the three words, the switch and the audience in INSTRUCTIONS', () => {
    for (const word of ['@everyone', '@all', '@الجميع', 'Mention everyone', 'chat.mentionEveryone']) expect(INSTRUCTIONS, word).toContain(word);
  });

  it('names the words, the switch, the push without email and the quiet hours in chats.send and comments.create', () => {
    for (const name of ['chats.send', 'comments.create']) {
      const text = TOOL_DOCS[name].description;
      for (const word of ['@everyone', '@الجميع', 'Mention everyone', 'no email', 'Quiet hours']) expect(text, `${name} ${word}`).toContain(word);
      expect(text.length, name).toBeLessThanOrEqual(600);
    }
  });

  it('keeps the two calls of the settings on the deny list', () => {
    for (const name of ['me.updatePreferences', 'settings.update']) expect(MCP_DENY as readonly string[], name).toContain(name);
  });

  it('keeps "Mention everyone" out of the AI section: it is a chat switch and opens no tool', () => {
    const power = CATALOG_SECTIONS.flatMap((section) => section.powers.map((one) => ({ section: section.key, one }))).find((item) => item.one.power === 'chat.mentionEveryone')!;
    expect(power.section).toBe('chat');
    expect(power.one.mcpTools).toBeUndefined();
  });
});
