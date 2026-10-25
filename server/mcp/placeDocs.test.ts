import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { mcpTools } from './tools';

describe('the agent docs of the place of a project (owner, 2026-10-19)', () => {
  it('say in projects.update that the location is the address of the pin and that geo and location go together', () => {
    const text = TOOL_DOCS['projects.update'].description;
    for (const word of ['address of the pin', 'geo and location together', 'clears the address', 'location_needs_pin']) expect(text, word).toContain(word);
    expect(text.length).toBeLessThanOrEqual(600);
  });

  it('say in projects.get that the location is the address of the pin', () => {
    expect(TOOL_DOCS['projects.get'].description).toContain('location is the address of the pin');
  });

  it('say the same rule in the instructions, in one line', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Place:'));
    expect(line).toBeDefined();
    for (const word of ['address of its pin', 'geo and location together', 'clears the old address', 'location_needs_pin']) expect(line, word).toContain(word);
  });

  it('give the agent the pin and the location in one patch', () => {
    const tool = mcpTools().find((t) => t.name === 'projects.update')!;
    expect(tool.input.safeParse({ id: 'prj_001', patch: { geo: { lat: 26.28, lng: 50.21 }, location: 'King Fahd Road, Dammam' } }).success).toBe(true);
  });

  it('keep the link calls out of the tool list: a location link is set in the screens', () => {
    const names = mcpTools().map((t) => t.name);
    expect(names).not.toContain('projects.addLink');
    expect(names).not.toContain('projects.updateLink');
  });
});
