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
});
