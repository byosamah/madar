import { describe, expect, it } from 'vitest';
import type { ProjectTemplate } from '../../api/contract/entities';
import { emptyProjectForm, emptyTemplateChoice, validateProjectForm } from './projectForm';

// 10 working days, and the second task does not stretch. 2026-10-04 is a Sunday.
const TEMPLATE: ProjectTemplate = {
  id: 'ptp_003', name: 'Villa', createdBy: 'usr_001', createdAt: '2026-09-20T09:00:00.000+03:00', updatedAt: '2026-09-20T09:00:00.000+03:00',
  roles: [],
  stages: [{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 0, durationDays: 5, flexible: true },
    { id: 't2', stageId: 's1', title: 'Plans', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 5, durationDays: 5, flexible: false },
  ],
};

describe('the project form with a project template (owner, 2026-10-05, item 6a)', () => {
  const valid = { ...emptyProjectForm(['Concept']), name: 'Villa Noor' };
  const rules = { templates: [TEMPLATE] };

  it('starts with no template', () => {
    expect(emptyTemplateChoice()).toEqual({ templateId: '', templateRoles: {}, templateStretch: {} });
    expect(emptyProjectForm([])).toMatchObject(emptyTemplateChoice());
  });

  it('needs a start date with a template', () => {
    expect(validateProjectForm({ ...valid, templateId: 'ptp_003' }, rules)).toEqual({ startDate: 'templateUse.errors.startRequired' });
    expect(validateProjectForm({ ...valid, templateId: 'ptp_003', startDate: '2026-10-04' }, rules)).toEqual({});
  });

  it('refuses an end date that the locked tasks do not fit', () => {
    const early = { ...valid, templateId: 'ptp_003', startDate: '2026-10-04', targetEndDate: '2026-10-06' };
    expect(validateProjectForm(early, rules)).toEqual({ targetEndDate: 'templateUse.errors.endTooEarly' });
    // When the person lets the locked task stretch, the plan fits.
    expect(validateProjectForm({ ...early, templateStretch: { t2: true } }, rules)).toEqual({});
  });

  it('leaves out the stage list rules, because the stages come from the template', () => {
    expect(validateProjectForm({ ...valid, stages: [], templateId: 'ptp_003', startDate: '2026-10-04' }, rules)).toEqual({});
  });

  it('keeps the rule of the end after the start', () => {
    const same = { ...valid, templateId: 'ptp_003', startDate: '2026-10-04', targetEndDate: '2026-10-04' };
    expect(validateProjectForm(same, rules).targetEndDate).toBe('projectForm.errors.endAfterStart');
  });
});
