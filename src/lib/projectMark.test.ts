import { describe, expect, it } from 'vitest';
import { projectHue } from './projectColor';
import { FORMS, MARK_COUNT, decodeMark, formPath, markOf, pickMark } from './projectMark';

/** Gives n projects their marks one by one, the way the office creates them. */
function office(n: number) {
  const projects: { id: string; mark: number }[] = [];
  for (let i = 1; i <= n; i++) {
    const id = `prj_${String(i).padStart(3, '0')}`;
    projects.push({ id, mark: pickMark(id, projects) });
  }
  return projects;
}

describe('project marks', () => {
  it('has 23 forms and one mark per form and second light', () => {
    expect(FORMS).toHaveLength(23);
    expect(MARK_COUNT).toBe(23 * 8);
  });

  it('gives the first 23 projects 23 different forms', () => {
    const forms = office(23).map((project) => project.mark % FORMS.length);
    expect(new Set(forms).size).toBe(23);
  });

  it('never gives two projects the same picture, even with 300 projects', () => {
    const pictures = office(300).map((project) => `${projectHue(project.id)}:${project.mark}`);
    expect(new Set(pictures).size).toBe(300);
  });

  it('keeps the second light different from the project color', () => {
    for (const project of office(40)) expect(decodeMark(project.mark).light).not.toBe(projectHue(project.id));
  });

  it('spreads the forms evenly once every form is used', () => {
    const counts = new Map<number, number>();
    for (const project of office(46)) counts.set(project.mark % FORMS.length, (counts.get(project.mark % FORMS.length) ?? 0) + 1);
    expect([...counts.values()].every((count) => count === 2)).toBe(true);
  });

  it('reads a stored mark and falls back to a fixed one for a project without a mark', () => {
    expect(markOf({ id: 'prj_001', mark: 7 })).toBe(7);
    expect(markOf({ id: 'prj_001' })).toBe(markOf({ id: 'prj_001' }));
    expect(decodeMark(markOf({ id: 'prj_001' })).light).not.toBe(projectHue('prj_001'));
  });

  it('draws every form as a closed path inside its box', () => {
    for (const form of FORMS) {
      const path = formPath(form, 0, 0, 18);
      expect(path).toMatch(/^M/);
      expect(path).toMatch(/Z$/);
      const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...numbers)).toBeLessThanOrEqual(18);
    }
  });
});
