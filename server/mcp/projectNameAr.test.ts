import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_BY_RIGHT } from './tools';

/**
 * The Arabic name of a project (owner, 2026-10-26, fbk_062). The calls carry nameAr through their zod input and output, so no tool changes its
 * list. The words tell an agent how to fill the Arabic names when a person gives it a list.
 */
describe('the MCP side of the Arabic name of a project', () => {
  it('keeps the tools of the projects where they were', () => {
    expect(MCP_ALLOW as readonly string[]).toEqual(expect.arrayContaining(['projects.get', 'projects.list', 'projects.update']));
    expect(Object.keys(MCP_BY_RIGHT)).toContain('projects.create');
  });

  it('names nameAr in the reads and in the writes', () => {
    expect(TOOL_DOCS['projects.get'].description).toContain('nameAr');
    expect(TOOL_DOCS['projects.list'].description).toContain('nameAr');
    expect(TOOL_DOCS['projects.create'].description).toContain('nameAr');
    expect(TOOL_DOCS['projects.update'].description).toContain('nameAr');
    for (const name of ['projects.get', 'projects.list', 'projects.create', 'projects.update']) expect(TOOL_DOCS[name].description.length, name).toBeLessThanOrEqual(600);
  });

  it('tells the agent how to fill a list of Arabic names, and not to invent one', () => {
    expect(INSTRUCTIONS).toContain('Arabic names: a project can have an Arabic name (nameAr)');
    expect(INSTRUCTIONS).toContain('When your person gives you a list of Arabic names, call projects.list');
    expect(INSTRUCTIONS).toContain('call projects.update with nameAr for each project');
    expect(INSTRUCTIONS).toContain('Search finds a project by either name');
    expect(INSTRUCTIONS).toContain('Never write an Arabic name yourself');
    expect(TOOL_DOCS['projects.create'].description).toContain('nameAr only if your person gives it');
    expect(TOOL_DOCS['projects.update'].description).toContain('nameAr (empty clears it)');
  });
});
