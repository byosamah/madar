import { describe, expect, it } from 'vitest';
import { AT_RISK_DAYS_PAST_DUE } from '../../src/api/health';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';

/** The agent docs of the Dashboard batch (owner, 2026-10-06). */
describe('the agent docs of the Dashboard batch (owner, 2026-10-06)', () => {
  it('explain the health rule in one line of the instructions, with the 3-day rule for past-due tasks', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Health:'));
    expect(line).toBeDefined();
    for (const word of [`${AT_RISK_DAYS_PAST_DUE} or more days past due`, 'late', 'at risk', '70%', '1 or 2 days past due']) expect(line, word).toContain(word);
  });

  it('name the Leader and Client filters of tasks.list and deadlines.list', () => {
    for (const name of ['tasks.list', 'deadlines.list']) {
      for (const word of ['leaderId', 'clientId', 'teamId']) expect(TOOL_DOCS[name].description, `${name} ${word}`).toContain(word);
    }
  });

  it('explain the People tab: overdue first, weeks from today, reviews for the reviewer, and the workOf list', () => {
    const dashboard = TOOL_DOCS['dashboard.get'].description;
    for (const word of ['overdue', 'from today', 'review']) expect(dashboard, word).toContain(word);
    expect(TOOL_DOCS['tasks.list'].description).toContain('workOf');
  });

  it('name the count of projects in design with no area', () => {
    expect(TOOL_DOCS['dashboard.get'].description).toContain('inDesignWithoutArea');
  });

  it('name the submissions chart', () => {
    expect(TOOL_DOCS['dashboard.get'].description).toContain('submissions');
  });

  it('name the client items that wait for the office', () => {
    expect(TOOL_DOCS['dashboard.get'].description).toContain('waitingForUs');
  });

  it('name the tasks in review by reviewer', () => {
    expect(TOOL_DOCS['dashboard.get'].description).toContain('inReview');
  });

  it('say that the gaps need the gaps right (the Admin has it), and name the filters that list them', () => {
    expect(TOOL_DOCS['dashboard.get'].description).toMatch(/gaps[^.]*gaps right[^.]*null/);
    for (const field of ['noDueDate', 'noLead', 'projectsStageNoEnd', 'noArea']) expect(TOOL_DOCS['dashboard.get'].description, field).toContain(field);
    expect(TOOL_DOCS['tasks.list'].description).toContain('no_date');
    for (const word of ['no_area', 'stage_no_end']) expect(TOOL_DOCS['projects.list'].description).toContain(word);
  });

  it('say that the money is for people with the payment right, else null (fbk_014)', () => {
    expect(TOOL_DOCS['dashboard.get'].description).toMatch(/money[^.]*payment right[^.]*null/);
  });

  it('say in the instructions that the Admin decides what each role may do (fbk_014)', () => {
    expect(INSTRUCTIONS).toContain('The Admin decides what each role may do. A call that the role of your person may not make fails for you too.');
  });
});

// fbk_024 (owner, 2026-10-19): the People tab has a No lead row, and an agent reads it as workload.unassigned.
describe('the agent docs of the No lead row (fbk_024)', () => {
  it('name workload.unassigned in dashboard.get', () => {
    const dashboard = TOOL_DOCS['dashboard.get'].description;
    expect(dashboard).toContain('unassigned');
    expect(dashboard).toContain('tasks with no lead');
    expect(dashboard.length).toBeLessThanOrEqual(600);
  });
});
