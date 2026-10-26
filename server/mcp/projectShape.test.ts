import { describe, expect, it } from 'vitest';
import { tileSvg } from '../../src/lib/pictureLook';
import { OWNER_SHAPES } from '../../src/test/projectShapes';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { withPictureLooks } from './pictures';
import { MCP_ALLOW, mcpTools } from './tools';

/**
 * The shape of a project picture (owner, 2026-10-26). The calls carry `shape` through their zod input and output, so no tool changes its list.
 * An agent can set the shape of a tile when the person asks. It still cannot upload a picture.
 */
describe('the MCP side of the shape of a project picture', () => {
  it('keeps the tools of the projects where they were', () => {
    expect(MCP_ALLOW as readonly string[]).toEqual(expect.arrayContaining(['projects.get', 'projects.list', 'projects.update', 'pictures.get']));
  });

  it('takes shape in the input schema of projects.update, with an empty text and the pattern', () => {
    const tool = mcpTools().find((t) => t.name === 'projects.update')!;
    expect(tool.input.safeParse({ id: 'prj_001', patch: { shape: OWNER_SHAPES.madar } }).success).toBe(true);
    expect(tool.input.safeParse({ id: 'prj_001', patch: { shape: '' } }).success).toBe(true);
    expect(tool.input.safeParse({ id: 'prj_001', patch: { shape: 'L1 1' } }).success).toBe(false);
    expect(tool.input.safeParse({ id: 'prj_001', patch: { shape: 'M0 0" x' } }).success).toBe(false);
    expect(tool.input.safeParse({ id: 'prj_001', patch: { shape: `M${'1'.repeat(2000)}` } }).success).toBe(false);
  });

  it('names shape in projects.update and says that look.tile uses it in projects.get and projects.list', () => {
    expect(TOOL_DOCS['projects.update'].description).toContain('shape (SVG path; empty clears; never on your own idea: see Tile shapes)');
    for (const name of ['projects.get', 'projects.list']) {
      expect(TOOL_DOCS[name].description, name).toMatch(/look\.tile uses shape/);
    }
    for (const name of ['projects.get', 'projects.list', 'projects.create', 'projects.update', 'pictures.get']) {
      expect(TOOL_DOCS[name].description.length, name).toBeLessThanOrEqual(600);
    }
  });

  it('says in the Pictures paragraph that the shape of a tile is the one picture an agent can change', () => {
    const pictures = INSTRUCTIONS.split('\n').find((line) => line.startsWith('Pictures:'))!;
    expect(pictures).toContain('you cannot change one except the tile shape of a project (see Tile shapes)');
    expect(pictures).not.toContain('You cannot upload or change a picture');
    expect(TOOL_DOCS['pictures.get'].description).toContain('You cannot upload a picture.');
  });

  it('teaches an agent the owner procedure for a tile shape in one Tile shapes line', () => {
    const lines = INSTRUCTIONS.split('\n').filter((line) => line.startsWith('Tile shapes:'));
    expect(lines).toHaveLength(1);
    const line = lines[0];
    // The warning comes before the steps.
    expect(line.indexOf('Never set or change a tile shape on your own idea')).toBeGreaterThan(-1);
    expect(line.indexOf('Never set or change a tile shape on your own idea')).toBeLessThan(line.indexOf('(a)'));
    for (const word of [
      '(a) Ask your person for the inspiration source: which files or pictures of the project to use',
      '(b) Study them. Show about 5 options on a visual page', 'make an artifact when your client can', 'project tile at 34 px and at 22 px', 'one line on the idea of each',
      '(c) Your person picks one or asks for changes', 'until they accept one shape',
      '(d) Only then call projects.update with patch.shape',
      '(e) Tell your person what changed. Undo takes it back',
    ]) expect(line, word).toContain(word);
    // The steps come in order.
    const at = ['(a)', '(b)', '(c)', '(d)', '(e)'].map((step) => line.indexOf(step));
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });

  it('teaches an agent the format of the path and what the screens do with it', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Tile shapes:'))!;
    for (const word of [
      'An empty text takes the shape off', 'starts with M', 'a box of 18 by 18', '2000 characters or less', 'MmLlHhVvCcSsQqTtAaZz', '62% of the tile', 'even-odd', 'is a hole',
    ]) expect(line, word).toContain(word);
  });

  it('teaches an agent the drawing rules of the owner: a solid mass, the real outline, holes, clean geometry', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Tile shapes:'))!;
    for (const word of [
      'Design rules: a shape is a solid filled mass', 'Never draw an outline band', 'Never draw an abstract gesture of a concept', 'Trace the real outline from the own drawings of the project',
      'Use the plan first', 'a render or a photo only to confirm', 'Cut the special places of the project out of the mass as holes', 'true circles and arcs and clean geometry',
      'at least 1.3 units from the next hole and from the edge', 'thinner than 2 units of the 18 box', 'run out at the edges of the frame',
      'the main shape that only this project has', 'Never draw a shape that could fit any villa or any corniche',
    ]) expect(line, word).toContain(word);
  });

  it('keeps the key words of the procedure', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Tile shapes:'))!;
    for (const word of ['inspiration source', '5 options', 'accept', 'solid']) expect(line, word).toContain(word);
    expect(TOOL_DOCS['projects.update'].description).toContain('never on your own idea');
  });

  it('writes the line in short sentences with no dash and no -ing word', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Tile shapes:'))!;
    for (const sentence of line.split(/(?<=[.:])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25);
    expect(line).not.toMatch(/[—–]/);
    expect((line.match(/\b\w+ing\b/g) ?? []).filter((word) => word !== 'nothing')).toEqual([]);
  });

  it('gives look.tile the shape of the project in projects.list, projects.get and reports.office', () => {
    const office = { lists: { users: {}, subCompanies: {} } } as never;
    const project = { id: 'prj_001', mark: 12, shape: OWNER_SHAPES.kutla };
    const tile = tileSvg(project);
    expect(tile).toContain(`d="${OWNER_SHAPES.kutla}"`);
    const rows = withPictureLooks('projects.list', [{ project, health: null }], office, false) as { look: { tile: string } }[];
    expect(rows[0].look.tile).toBe(tile);
    const one = withPictureLooks('projects.get', { project, members: [] }, office, false) as { look: { tile: string } };
    expect(one.look.tile).toBe(tile);
    const report = withPictureLooks('reports.office', { projects: [{ project, subCompany: null }], people: [] }, office, false) as { projects: { look: { tile: string } }[] };
    expect(report.projects[0].look.tile).toBe(tile);
  });
});
