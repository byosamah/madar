import { describe, expect, it } from 'vitest';
import { areaValue, emptyProjectForm, validateProjectForm } from './projectForm';

describe('the project form checks', () => {
  const valid = { ...emptyProjectForm(['Concept', 'Permits']), name: 'Harbour Gate Offices' };

  it('needs only a name', () => {
    expect(validateProjectForm(valid)).toEqual({});
    expect(validateProjectForm({ ...valid, name: '  ' })).toEqual({ name: 'projectForm.errors.nameRequired' });
  });

  it('checks the area, the dates and the stages', () => {
    expect(validateProjectForm({ ...valid, area: '-5' }).area).toBe('projectForm.errors.areaNumber');
    expect(validateProjectForm({ ...valid, area: 'big' }).area).toBe('projectForm.errors.areaNumber');
    expect(validateProjectForm({ ...valid, startDate: '2026-10-01', targetEndDate: '2026-10-01' }).targetEndDate).toBe('projectForm.errors.endAfterStart');
    expect(validateProjectForm({ ...valid, stages: [] }).stages).toBe('projectForm.errors.stageRequired');
    expect(validateProjectForm({ ...valid, stages: [{ name: ' ' }] }).stages).toBe('projectForm.errors.stageName');
  });

  // An Arabic phone keyboard types Arabic-Indic digits and the Arabic decimal mark (audit PER-16).
  it('reads an area typed with Arabic-Indic or Persian digits', () => {
    expect(validateProjectForm({ ...valid, area: '١٢٠٠' })).toEqual({});
    expect(areaValue('١٢٠٠٫٥')).toBe(1200.5);
    expect(areaValue('۱٬۸۰۰')).toBe(1800);
    expect(areaValue('  ')).toBeNull();
  });
});

describe('the form of an internal project (fbk_044)', () => {
  it('needs no code parts and no sub-company, and a client project still needs both', () => {
    const base = { ...emptyProjectForm(['Plan']), name: 'Portfolio' };
    expect(Object.keys(validateProjectForm(base, { create: true, subCompanies: true }))).toEqual(expect.arrayContaining(['subCompanyId', 'initials']));
    expect(validateProjectForm({ ...base, kind: 'internal' }, { create: true, subCompanies: true })).toEqual({});
  });
});
