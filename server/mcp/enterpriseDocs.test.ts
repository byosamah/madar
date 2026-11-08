import { describe, expect, it } from 'vitest';
import { PLATFORM_CALL_NAMES } from '../../src/api/contract/platform';
import { INSTRUCTIONS, readFirstAnswer, TOOL_DOCS } from './docs';
import { PARITY_DOCS } from './docsParity';
import { mcpTools } from './tools';

const person = { name: 'Layla Hassan', systemRole: 'admin' as const, roleId: undefined };

describe('the MCP words for an office of one enterprise (Madar enterprises, design 5.5)', () => {
  it('INSTRUCTIONS names no architecture office, no Vado and no Bunah', () => {
    expect(INSTRUCTIONS).not.toMatch(/architecture office|vado|bunah|mazj|khobar/i);
  });

  it('INSTRUCTIONS says one person of one enterprise, and sees nothing of another', () => {
    expect(INSTRUCTIONS).toContain('Madar is the project tool of one enterprise: projects, stages, tasks, updates, comments, the client tracker, payments and deadlines.');
    expect(INSTRUCTIONS).toContain("1. You act for one person of one enterprise, with that person's rights and never more. You see nothing of any other enterprise. You have no role of your own.");
    expect(INSTRUCTIONS).toContain('for example the brands or the branches of one group');
  });

  it('readFirstAnswer names the enterprise and keeps the old line without it', () => {
    expect(readFirstAnswer(person, undefined, undefined, { name: 'Oasis Builders' })).toContain('You act for Layla Hassan of Oasis Builders, whose role in Madar is');
    const plain = readFirstAnswer(person);
    expect(plain).toContain('You act for Layla Hassan, whose role in Madar is');
    expect(plain).not.toContain(' of Oasis Builders');
  });

  it('settings docs name the three enterprise fields and the owner-only limits', () => {
    for (const name of ['settings.get', 'settings.update']) {
      const text = PARITY_DOCS[name].description;
      expect(text, name).toContain('enterpriseName');
      expect(text, name).toContain('enterpriseNameAr');
      expect(text, name).toContain('enterpriseLogo');
      expect(text, name).toMatch(/limits of people and storage/);
      expect(text, name).toMatch(/cannot change/);
      expect(text.length, name).toBeGreaterThanOrEqual(40);
      expect(text.length, name).toBeLessThanOrEqual(600);
    }
    expect(TOOL_DOCS['settings.get']).toBe(PARITY_DOCS['settings.get']);
  });

  it('the tool list of an Admin agent holds no name that starts with platform.', () => {
    const names = mcpTools({ admin: true }).map((tool) => tool.name);
    expect(names.filter((name) => name.startsWith('platform.'))).toEqual([]);
    for (const name of PLATFORM_CALL_NAMES) expect(names).not.toContain(name);
    expect(Object.keys(TOOL_DOCS).filter((name) => name.startsWith('platform.'))).toEqual([]);
  });
});
