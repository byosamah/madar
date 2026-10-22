import { describe, expect, it } from 'vitest';
import { meetingsListInput } from '../features/meetings/readInputs';
import { MINE_OPEN, REVIEW_FOR_ME } from '../features/work/readInputs';
import { todayISO } from '../lib/dates';
import { PRESS_READS } from './pressReads';

const run = (to: string) => {
  const asked: [string, unknown][] = [];
  for (const start of PRESS_READS[to]()) start(((name: string, input: unknown) => { asked.push([name, input]); }) as never);
  return asked;
};

describe('the press reads of the phone tabs', () => {
  it('/work starts my open list and my review list', () => {
    expect(run('/work')).toEqual([['tasks.list', { filter: 'mine', includeDone: false }], ['tasks.list', { filter: 'review_for_me' }]]);
    expect(MINE_OPEN).toEqual({ filter: 'mine', includeDone: false });
    expect(REVIEW_FOR_ME).toEqual({ filter: 'review_for_me' });
  });

  it('/meetings starts the Meetings list of today', () => {
    expect(run('/meetings')).toEqual([['meetings.list', meetingsListInput(todayISO())]]);
  });

  it('/me starts settings.get, and google.status in the remote build only', () => {
    const names = run('/me').map(([name]) => name);
    expect(names[0]).toBe('settings.get');
    // The test build is the prototype, so google.status is not asked.
    expect(names).not.toContain('google.status');
  });

  it('/inbox and /notifications stay as they are', () => {
    expect(run('/inbox')).toEqual([['chats.list', {}]]);
    expect(run('/notifications')).toEqual([['notifications.list', {}]]);
  });

  it('meetingsListInput looks 7 days back and 60 days ahead for my meetings', () => {
    expect(meetingsListInput('2026-10-22')).toEqual({ from: '2026-10-15', to: '2026-12-21', mine: true });
  });
});
