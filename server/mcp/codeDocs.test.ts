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

  it('say in projects.update that the code right corrects the code, by default only the Admin (fbk_014)', () => {
    expect(TOOL_DOCS['projects.update'].description).toContain('needs the code right (by default only the Admin)');
  });

  it('say in the instructions that the code right corrects the code, by default only the Admin (fbk_014)', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Project codes:'))!;
    expect(line).toContain('needs the code right (by default only the Admin)');
  });

  it('give the agent the code field in the projects.update schema, with both forms and a code of its own', () => {
    const tool = mcpTools().find((t) => t.name === 'projects.update')!;
    expect(tool.input.safeParse({ id: 'prj_001', patch: { code: '260902AZT-RES-Villa' } }).success).toBe(true);
    expect(tool.input.safeParse({ id: 'prj_001', patch: { code: 'KH-26-014' } }).success).toBe(true);
    // A code outside the pattern reaches the handler, which asks for codeAnyway (feedback fbk_003, 2026-10-12). Two lines never do.
    expect(tool.input.safeParse({ id: 'prj_001', patch: { code: '260902AZT-XYZ-Villa' }, codeAnyway: true }).success).toBe(true);
    expect(tool.input.safeParse({ id: 'prj_001', patch: { code: '260902AZT\nVilla' } }).success).toBe(false);
  });

  it('say in the instructions that a code of its own needs the person and codeAnyway (feedback fbk_003)', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Project codes:'))!;
    for (const word of ['code_format', 'code_taken', 'codeAnyway: true', 'only your person decides']) expect(line, word).toContain(word);
  });
});
