import { describe, expect, it } from 'vitest';
import type { ProjectTemplate } from '../../api/contract/entities';
import { fixedIdsOf, planOfForm, roleChoice, setStageStretch, showStretch, stageStretch, templateInput, type TemplateValues } from './templateForm';

// 2026-10-04 is a Sunday. 15 working days: Concept 0 to 10, Permits 10 to 15 (locked by the template).
const TEMPLATE: ProjectTemplate = {
  id: 'ptp_003', name: 'Villa', createdBy: 'usr_001', createdAt: '2026-09-20T09:00:00.000+03:00', updatedAt: '2026-09-20T09:00:00.000+03:00',
  roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }, { id: 'r2', name: 'Permits', defaultUserId: null }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: null, durationDays: null },
    { id: 's2', name: 'Permits', startOffset: null, durationDays: null },
    { id: 's3', name: 'Handover', startOffset: 15, durationDays: 2 },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing', description: '', checklist: [], needsReview: true, roleId: 'r1', startOffset: 0, durationDays: 5, flexible: true },
    { id: 't2', stageId: 's1', title: 'Plans', description: '', checklist: [], needsReview: true, roleId: 'r1', startOffset: 5, durationDays: 5, flexible: true },
    { id: 't3', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: true, roleId: 'r2', startOffset: 10, durationDays: 5, flexible: false },
  ],
};

const values = (change: Partial<TemplateValues> = {}): TemplateValues => ({
  startDate: '2026-10-04', targetEndDate: '', templateRoles: {}, templateStretch: {}, ...change,
});
const people = [{ id: 'usr_002', active: true }, { id: 'usr_003', active: true }];

describe('the template part of the new-project form', () => {
  it('takes the default person of a role until the person picks another one or No lead', () => {
    expect(roleChoice(TEMPLATE.roles[0], values(), people)).toBe('usr_002');
    expect(roleChoice(TEMPLATE.roles[0], values({ templateRoles: { r1: 'usr_003' } }), people)).toBe('usr_003');
    expect(roleChoice(TEMPLATE.roles[0], values({ templateRoles: { r1: '' } }), people)).toBe('');
    expect(roleChoice(TEMPLATE.roles[1], values(), people)).toBe('');
    // A default person who left the office is not offered.
    expect(roleChoice(TEMPLATE.roles[0], values(), [{ id: 'usr_002', active: false }])).toBe('');
  });

  it('locks the tasks that the template locks, until the person ticks them', () => {
    expect(fixedIdsOf(TEMPLATE, {})).toEqual(['t3']);
    expect(fixedIdsOf(TEMPLATE, { t3: true, t1: false, s3: false })).toEqual(['t1', 's3']);
  });

  it('locks a stage with its own numbers when all its tasks are locked', () => {
    // Concept has its own numbers. Its tasks t1 and t2 stretch, and t3 is locked by the template.
    const own = { ...TEMPLATE, stages: TEMPLATE.stages.map((stage) => (stage.id === 's1' ? { ...stage, startOffset: 0, durationDays: 10 } : stage)) };
    expect(fixedIdsOf(own, {})).toEqual(['t3']);
    expect(fixedIdsOf(own, { t1: false })).toEqual(['t1', 't3']);
    expect(fixedIdsOf(own, { t1: false, t2: false })).toEqual(['t1', 't2', 't3', 's1']);
  });

  it('gives a stage tick for all its tasks: on, off or mixed', () => {
    expect(stageStretch(TEMPLATE, 's1', {})).toBe('on');
    expect(stageStretch(TEMPLATE, 's2', {})).toBe('off');
    expect(stageStretch(TEMPLATE, 's1', { t2: false })).toBe('mixed');
    // A stage with no tasks has its own tick.
    expect(stageStretch(TEMPLATE, 's3', {})).toBe('on');
    expect(setStageStretch(TEMPLATE, 's1', false, { t3: true })).toEqual({ t3: true, t1: false, t2: false });
    expect(setStageStretch(TEMPLATE, 's3', false, {})).toEqual({ s3: false });
  });

  it('plans only with a start date, and keeps the template length with no end date', () => {
    expect(planOfForm(TEMPLATE, values({ startDate: '' }))).toBeNull();
    expect(planOfForm(TEMPLATE, values())).toMatchObject({ ok: true, templateDays: 17, days: 17, endDate: '2026-10-26' });
  });

  it('shrinks to the end date, and says when the locked tasks do not fit', () => {
    expect(planOfForm(TEMPLATE, values({ targetEndDate: '2026-10-22' }))).toMatchObject({ ok: true, days: 15 });
    expect(planOfForm(TEMPLATE, values({ targetEndDate: '2026-10-06' }))).toEqual({ ok: false, templateDays: 17, targetDays: 3, needs: 5 });
  });

  it('shows the stretch ticks only when the end date gives another length than the template', () => {
    expect(showStretch(TEMPLATE, values())).toBe(false);
    expect(showStretch(TEMPLATE, values({ targetEndDate: '2026-10-26' }))).toBe(false);
    expect(showStretch(TEMPLATE, values({ targetEndDate: '2026-10-22' }))).toBe(true);
    expect(showStretch(TEMPLATE, values({ startDate: '', targetEndDate: '2026-10-22' }))).toBe(false);
  });

  it('builds the template part of projects.create', () => {
    expect(templateInput(TEMPLATE, values({ targetEndDate: '2026-10-22', templateRoles: { r1: 'usr_003' }, templateStretch: { t1: false } }), people)).toEqual({
      templateId: 'ptp_003', startDate: '2026-10-04', endDate: '2026-10-22', roles: { r1: 'usr_003', r2: null }, fixedTaskIds: ['t1', 't3'],
    });
    expect(templateInput(TEMPLATE, values(), people)).toMatchObject({ endDate: null, roles: { r1: 'usr_002', r2: null } });
  });
});
