import { describe, expect, it } from 'vitest';
import { tileSvg } from '../../src/lib/pictureLook';
import { OWNER_SHAPES } from '../../src/test/projectShapes';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { withPictureLooks } from './pictures';
import { MCP_ALLOW } from './tools';

/**
 * The shape of a project picture (owner, 2026-10-26). The calls carry `shape` through their zod input and output, so no tool changes its list.
 * An agent can set the shape of a picture when the person asks. It still cannot upload a picture.
 */
describe('the MCP side of the shape of a project picture', () => {
  it('keeps the tools of the projects where they were', () => {
    expect(MCP_ALLOW as readonly string[]).toEqual(expect.arrayContaining(['projects.get', 'projects.list', 'projects.update', 'pictures.get']));
  });

  it('names shape in projects.update and says that look.tile uses it in projects.get and projects.list', () => {
    expect(TOOL_DOCS['projects.update'].description).toContain('shape');
    expect(TOOL_DOCS['projects.update'].description).toContain('null');
    for (const name of ['projects.get', 'projects.list']) {
      expect(TOOL_DOCS[name].description, name).toMatch(/look\.tile uses (the )?shape/);
    }
    for (const name of ['projects.get', 'projects.list', 'projects.create', 'projects.update', 'pictures.get']) {
      expect(TOOL_DOCS[name].description.length, name).toBeLessThanOrEqual(600);
    }
  });

  it('tells the agent in the Pictures paragraph how to set a shape, and that it still cannot upload a picture', () => {
    const pictures = INSTRUCTIONS.split('\n').find((line) => line.startsWith('Pictures:'))!;
    expect(pictures).toContain('projects.update');
    expect(pictures).toContain('shape');
    expect(pictures).toContain('one SVG path in a box of 18 by 18');
    expect(pictures).toContain('the glow stays');
    expect(pictures).toContain('null brings back the drawn form');
    expect(pictures).toContain('only when your person asks');
    expect(pictures).toContain('You cannot upload a picture');
    expect(pictures).not.toContain('You cannot upload or change a picture');
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
