import { describe, expect, it } from 'vitest';
import { clientParam, closeMeeting, dayParam, meetingParam, oneOf, openMeeting, trackerEntryLink, userParam } from './params';

describe('link values', () => {
  it('keeps a known value and falls back on anything else', () => {
    expect(oneOf('quarter', ['month', 'quarter'] as const, 'month')).toBe('quarter');
    expect(oneOf('decade', ['month', 'quarter'] as const, 'month')).toBe('month');
    expect(oneOf(null, ['month', 'quarter'] as const, 'month')).toBe('month');
  });

  it('keeps a real day only', () => {
    expect(dayParam('2026-09-30')).toBe('2026-09-30');
    expect(dayParam('banana')).toBeUndefined();
    expect(dayParam('2026-02-31')).toBeUndefined();
    expect(dayParam(null)).toBeUndefined();
  });

  it('keeps a person or a client id only when it has the form of one (owner, 2026-10-06)', () => {
    expect(userParam('usr_002')).toBe('usr_002');
    expect(userParam('nobody')).toBeUndefined();
    expect(userParam(null)).toBeUndefined();
    expect(clientParam('cli_001')).toBe('cli_001');
    expect(clientParam('usr_001')).toBeUndefined();
    expect(clientParam('')).toBeUndefined();
  });

  it('opens and closes the sheet of a meeting by its id (fbk_022)', () => {
    expect(meetingParam('mtg_001')).toBe('mtg_001');
    expect(meetingParam('tsk_001')).toBeUndefined();
    expect(meetingParam('mtg_1')).toBeUndefined();
    expect(meetingParam(null)).toBeUndefined();
    const open = openMeeting(new URLSearchParams('x=1'), 'mtg_002');
    expect(open.toString()).toBe('x=1&meeting=mtg_002');
    expect(closeMeeting(open).toString()).toBe('x=1');
  });
});

describe('trackerEntryLink (wave 2)', () => {
  it('opens the sheet of one Tracker entry on the Tracker tab of its project', () => {
    expect(trackerEntryLink('prj_001', 'trk_900')).toBe('/projects/prj_001?tab=tracker&entry=trk_900');
  });
});

