import { describe, expect, it } from 'vitest';
import { emptyProjectForm, validateProjectForm } from './projectForm';

describe('the project form rules for the code (item 6b)', () => {
  const named = { ...emptyProjectForm(['Concept']), name: 'Zahra Villas' };

  it('asks a new project for its code parts', () => {
    expect(validateProjectForm(named, { create: true })).toEqual({
      initials: 'projectCode.errors.initials', classification: 'projectCode.errors.classification', buildingType: 'projectCode.errors.type',
    });
    expect(validateProjectForm({ ...named, initials: 'AZT', classification: 'RES', buildingType: 'Villa' }, { create: true })).toEqual({});
  });

  it('checks the Admin\'s code correction in the edit form only', () => {
    expect(validateProjectForm({ ...named, code: 'KH-26-001' }, { editCode: true })).toEqual({});
    expect(validateProjectForm({ ...named, code: '260902AZT-RES-Villa' }, { editCode: true })).toEqual({});
    expect(validateProjectForm({ ...named, code: '' }, { editCode: true })).toEqual({ code: 'projectCode.errors.full' });
    expect(validateProjectForm({ ...named, code: '' })).toEqual({});
  });
});
