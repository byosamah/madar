import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { argsDigest, reasonFor, retryText, stateKeyFrom } from './reasons';

describe('the reasons an agent must ask its person for (plan 5.6, change 7)', () => {
  it('asks for "reason" when a change moves the project back to an earlier stage', () => {
    const error = new ApiError('invalid_input', 'Write why the project moves back.', { fields: ['reason'], reason: 'stage_back_reason', stageId: 'stg_002', stageName: 'Concept', canLog: true });
    const ask = reasonFor(error);
    expect(ask?.field).toBe('reason');
    expect(ask?.question).toContain('Concept');
  });

  it('asks for "dateReason" when a change moves dates that were already set', () => {
    const ask = reasonFor({ code: 'invalid_input', message: 'Write why the dates change.', details: { fields: ['dateReason'], reason: 'date_reason_needed' } });
    expect(ask?.field).toBe('dateReason');
    expect(ask?.question.length).toBeGreaterThan(10);
  });

  it('asks for nothing on any other error', () => {
    expect(reasonFor(new ApiError('forbidden', 'No.'))).toBeNull();
    expect(reasonFor({ code: 'invalid_input', message: 'Bad.', details: { fields: ['title'] } })).toBeNull();
    expect(reasonFor({ code: 'failed', message: 'x' })).toBeNull();
  });

  it('tells an agent with no elicitation to call again with the field, and never to invent a reason', () => {
    const text = retryText('tasks.move', { field: 'reason', question: 'Why?' });
    expect(text).toContain('tasks.move');
    expect(text).toContain('"reason"');
    expect(text).toMatch(/never invent/i);
  });

  it('binds a digest to the tool and the arguments, whatever the key order, and leaves out the asked field and storyId', async () => {
    const a = await argsDigest('tasks.move', { id: 'tsk_001', status: 'done' }, 'reason');
    expect(await argsDigest('tasks.move', { status: 'done', id: 'tsk_001' }, 'reason')).toBe(a);
    expect(await argsDigest('tasks.move', { status: 'done', id: 'tsk_001', reason: 'x', storyId: 'sty_1' }, 'reason')).toBe(a);
    expect(await argsDigest('tasks.move', { id: 'tsk_002', status: 'done' }, 'reason')).not.toBe(a);
    expect(await argsDigest('tasks.update', { id: 'tsk_001', status: 'done' }, 'reason')).not.toBe(a);
  });

  it('derives a 32-byte state key from the server secret key, the same for the same secret', async () => {
    const one = await stateKeyFrom('sb_secret_one');
    expect(one).toHaveLength(32);
    expect(await stateKeyFrom('sb_secret_one')).toEqual(one);
    expect(await stateKeyFrom('sb_secret_two')).not.toEqual(one);
  });
});
