import { describe, expect, it } from 'vitest';
import type { ProjectTemplate, Stage, Task } from '../api/contract/entities';
import { matchByNames, normalName } from './templateMatch';

// Some Arabic letters are written as code points, so the test shows which letter each rule reads.
const ALEF_HAMZA_ABOVE = 'أ';
const ALEF_HAMZA_BELOW = 'إ';
const ALEF_MADD = 'آ';
const ALEF = 'ا';
const ALEF_MAKSURA = 'ى';
const YEH = 'ي';
const TA_MARBUTA = 'ة';
const HEH = 'ه';
const TATWEEL = 'ـ';

const stage = (id: string, name: string, order: number) => ({ id, projectId: 'prj_001', name, order }) as Stage;
const task = (id: string, stageId: string, title: string) => ({ id, projectId: 'prj_001', stageId, title }) as Task;
const template = (stages: [string, string][], tasks: [string, string, string][]) => ({
  stages: stages.map(([id, name]) => ({ id, name })),
  tasks: tasks.map(([id, stageId, title]) => ({ id, stageId, title })),
}) as ProjectTemplate;

describe('normalName', () => {
  it('trims, lower-cases and keeps one space between words', () => {
    expect(normalName('  Site   Visit  ')).toBe('site visit');
  });

  it('reads a short vowel and a plain spelling as one name', () => {
    expect(normalName('  المرحلةُ الأولى ')).toBe(normalName('المرحله الاولى'));
  });

  it('keeps the shadda and the sukun, which are not short vowels', () => {
    expect(normalName('مّ')).toBe('مّ');
    expect(normalName('مْ')).toBe('مْ');
  });

  it('maps the alef forms to a plain alef', () => {
    expect(normalName(`${ALEF_HAMZA_ABOVE} ${ALEF_HAMZA_BELOW} ${ALEF_MADD}`)).toBe(`${ALEF} ${ALEF} ${ALEF}`);
  });

  it('maps the alef maksura to ya and the ta marbuta to ha', () => {
    expect(normalName(`عل${ALEF_MAKSURA}`)).toBe(`عل${YEH}`);
    expect(normalName(`مدرس${TA_MARBUTA}`)).toBe(`مدرس${HEH}`);
  });

  it('removes the tatweel', () => {
    expect(normalName(`ت${TATWEEL}صميم`)).toBe('تصميم');
  });
});

describe('matchByNames', () => {
  it('matches a stage by its name, after normalName', () => {
    const result = matchByNames(template([['s1', 'المرحلة الأولى']], []), [stage('stg_001', 'المرحله الاولى', 0)], []);
    expect(result.stages).toEqual({ s1: 'stg_001' });
  });

  it('gives null to a stage and a task with no name match', () => {
    const result = matchByNames(template([['s1', 'Permits']], [['t1', 's1', 'Balady pack']]), [stage('stg_001', 'Concept', 0)], []);
    expect(result).toEqual({ stages: { s1: null }, tasks: { t1: null } });
  });

  it('matches each project item once, even when two template parts share its name', () => {
    const result = matchByNames(
      template([['s1', 'Concept']], [['t1', 's1', 'Review'], ['t2', 's1', 'Review']]),
      [stage('stg_001', 'Concept', 0)],
      [task('tsk_001', 'stg_001', 'Review')],
    );
    expect(result.tasks).toEqual({ t1: 'tsk_001', t2: null });
  });

  it('matches a task title inside its own stage first, when two stages hold that title', () => {
    const result = matchByNames(
      template([['s1', 'Concept'], ['s2', 'Permits']], [['t1', 's1', 'Review'], ['t2', 's2', 'Review']]),
      [stage('stg_001', 'Concept', 0), stage('stg_002', 'Permits', 1)],
      [task('tsk_001', 'stg_002', 'Review'), task('tsk_002', 'stg_001', 'Review')],
    );
    expect(result.tasks).toEqual({ t1: 'tsk_002', t2: 'tsk_001' });
  });

  it('matches a task in any stage when its own stage has no match for it', () => {
    const result = matchByNames(
      template([['s1', 'Concept']], [['t1', 's1', 'Massing']]),
      [stage('stg_001', 'Concept', 0), stage('stg_002', 'Schematic', 1)],
      [task('tsk_001', 'stg_002', 'Massing')],
    );
    expect(result.tasks).toEqual({ t1: 'tsk_001' });
  });
});
