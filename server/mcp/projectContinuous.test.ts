import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_BY_RIGHT, mcpTools } from './tools';

/**
 * A continuous project (owner, 2026-10-26, fbk_069). The calls carry `continuous` through their zod input and output, so no tool changes its
 * list. The words tell an agent what the switch does: no end date, no Late from a stage date, and no data gap for a stage with no end date.
 */
describe('the MCP side of a continuous project', () => {
  it('keeps the tools of the projects where they were', () => {
    expect(MCP_ALLOW as readonly string[]).toEqual(expect.arrayContaining(['projects.get', 'projects.list', 'projects.update']));
    expect(Object.keys(MCP_BY_RIGHT)).toContain('projects.create');
  });

  it('takes continuous in the input of projects.update and projects.create', () => {
    const update = mcpTools().find((t) => t.name === 'projects.update')!;
    expect(update.input.safeParse({ id: 'prj_001', patch: { continuous: true } }).success).toBe(true);
    expect(update.input.safeParse({ id: 'prj_001', patch: { continuous: 'yes' } }).success).toBe(false);
    const create = mcpTools().find((t) => t.name === 'projects.create');
    if (create) {
      expect(create.input.safeParse({ name: 'Retainer', continuous: true }).success).toBe(true);
      expect(create.input.safeParse({ name: 'Retainer', continuous: 'yes' }).success).toBe(false);
    }
  });

  it('names continuous in the four project docs, each at most 600 characters', () => {
    for (const name of ['projects.get', 'projects.list', 'projects.create', 'projects.update']) {
      expect(TOOL_DOCS[name].description, name).toContain('continuous');
      expect(TOOL_DOCS[name].description.length, name).toBeLessThanOrEqual(600);
    }
  });

  it('says in Health that a stage date never makes a continuous project late, and in New projects what the switch does', () => {
    const health = INSTRUCTIONS.split('\n').find((line) => line.startsWith('Health:'))!;
    expect(health).toContain('A continuous project never turns late from a stage end date');
    expect(health).toContain('A task 3 or more days past due still puts it at risk');
    const created = INSTRUCTIONS.split('\n').find((line) => line.startsWith('New projects:'))!;
    expect(created).toContain('continuous');
    expect(created).toContain('no target end date');
  });
});
