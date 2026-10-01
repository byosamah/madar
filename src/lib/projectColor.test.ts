import { describe, expect, it } from 'vitest';
import { HUES, projectHue, projectInitials, stageProgress } from './projectColor';

describe('project colors', () => {
  it('gives each project one stable hue from its id', () => {
    expect(projectHue('prj_001')).toBe(projectHue('prj_001'));
    expect(HUES).toContain(projectHue('prj_002'));
    expect(new Set(['prj_001', 'prj_002', 'prj_003', 'prj_004', 'prj_005', 'prj_006'].map(projectHue)).size).toBeGreaterThan(3);
  });

  it('takes two letters for the tile, and skips the Arabic article', () => {
    expect(projectInitials('Corniche Office Tower')).toBe('CO');
    expect(projectInitials('Tamr')).toBe('TA');
    expect(projectInitials('مجمع النخلة')).toBe('من');
    expect(projectInitials('  ')).toBe('?');
  });

  it('moves the progress line one step per stage, and fills it for a completed project', () => {
    const stages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(stageProgress({ stages, currentStage: { id: 'a' }, project: { status: 'active' } })).toBeCloseTo(0.25);
    expect(stageProgress({ stages, currentStage: { id: 'c' }, project: { status: 'active' } })).toBeCloseTo(0.75);
    expect(stageProgress({ stages, currentStage: { id: 'c' }, project: { status: 'completed' } })).toBe(1);
  });
});
