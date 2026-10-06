import { describe, expect, it } from 'vitest';
import { AT_RISK_DAYS_PAST_DUE } from '../../src/api/health';
import { INSTRUCTIONS } from './docs';

/** The agent docs of the Dashboard batch (owner, 2026-10-06). */
describe('the agent docs of the Dashboard batch (owner, 2026-10-06)', () => {
  it('explain the health rule in one line of the instructions, with the 3-day rule for past-due tasks', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Health:'));
    expect(line).toBeDefined();
    for (const word of [`${AT_RISK_DAYS_PAST_DUE} or more days past due`, 'late', 'at risk', '70%', '1 or 2 days past due']) expect(line, word).toContain(word);
  });
});
