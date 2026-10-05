import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { mcpTools } from './tools';

describe('the agent docs of the project code (owner, 2026-10-05, item 6b)', () => {
  it('explain the code format and the key in one line of the instructions', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Project codes:'));
    expect(line).toBeDefined();
    for (const word of ['YYMMSSINI-CLS-Type', '260902AZT-RES-Villa', '260902AZT', 'KH-26-014', 'one contract', 'Admin']) expect(line, word).toContain(word);
  });

  it('name the code format in projects.list and projects.get', () => {
    for (const name of ['projects.list', 'projects.get']) {
      expect(TOOL_DOCS[name].description, name).toContain('260902AZT-RES-Villa');
      expect(TOOL_DOCS[name].description, name).toContain('KH-26-014');
    }
  });

  it('say in projects.update that only the Admin corrects the code', () => {
    expect(TOOL_DOCS['projects.update'].description).toMatch(/code.*Admin|Admin.*code/);
  });

  it('give the agent the code field in the projects.update schema, with both forms', () => {
    const tool = mcpTools().find((t) => t.name === 'projects.update')!;
    expect(tool.input.safeParse({ id: 'prj_001', patch: { code: '260902AZT-RES-Villa' } }).success).toBe(true);
    expect(tool.input.safeParse({ id: 'prj_001', patch: { code: 'KH-26-014' } }).success).toBe(true);
    expect(tool.input.safeParse({ id: 'prj_001', patch: { code: '260902AZT-XYZ-Villa' } }).success).toBe(false);
  });
});
