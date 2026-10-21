import { describe, expect, it } from 'vitest';
import { REPORT_DESIGN } from '../../src/api/reportDesign';
import { REPORT_GUIDE } from '../../src/api/reportGuide';
import { MCP_ALLOW, MCP_BY_RIGHT, MCP_DENY } from './tools';

/**
 * The guide of the Madar report (owner, 2026-10-21): reports.office gives it with guide: true, and the agent follows it. The guide
 * names tools, fields and colors. These tests keep it true when a tool, a field or a color changes.
 */

/** The tools that an agent can get: the allow list and the right list. */
const AGENT_TOOLS = new Set<string>([...MCP_ALLOW, ...Object.keys(MCP_BY_RIGHT)]);

/** The two fills of the step line, flat on a white page: --c-fill-strong (0.2) and --c-fill (0.12) of tokens.css on #FFFFFF. */
const STEP_FILLS = ['#E4E4E6', '#EFEFF0'];

describe('REPORT_GUIDE, the guide of the Madar report (owner, 2026-10-21)', () => {
  it('names only tools that an agent can get, and no tool of the deny list', () => {
    const named = [...REPORT_GUIDE.matchAll(/`([a-z][A-Za-z]*\.[a-z][A-Za-z]+)`/g)].map((match) => match[1]!);
    expect(named.length).toBeGreaterThan(5);
    for (const name of named) expect(AGENT_TOOLS.has(name), name).toBe(true);
    for (const name of MCP_DENY) expect(REPORT_GUIDE.includes(`\`${name}\``), name).toBe(false);
  });

  it('names the input and the answer fields of reports.office that it uses', () => {
    for (const word of ['guide: true', "period: 'range'", 'from', 'to', 'withPictures: true', 'trend', 'design.colors', 'subCompanyId']) {
      expect(REPORT_GUIDE, word).toContain(word);
    }
  });

  it('uses only the colors of the design guide, white and the two step fills', () => {
    const allowed = new Set([...Object.values(REPORT_DESIGN.colors), '#FFFFFF', ...STEP_FILLS].map((color) => color.toUpperCase()));
    const used = [...REPORT_GUIDE.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((match) => match[0].toUpperCase());
    expect(used.length).toBeGreaterThan(5);
    for (const color of used) expect(allowed.has(color), color).toBe(true);
  });

  it('has no long dash, and stays small enough for one answer', () => {
    expect(REPORT_GUIDE).not.toMatch(/[–—]/);
    expect(REPORT_GUIDE.length).toBeLessThan(20_000);
  });
});
