import { describe, expect, it, vi } from 'vitest';
import { chatLink, clientParam, closeMeeting, dayParam, meetingParam, messageParam, oneOf, openMeeting, replaceParam, trackerEntryLink, userParam } from './params';

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

  it('links a chat or a task thread, and one message in it', () => {
    expect(chatLink('cnv_001')).toBe('/inbox/cnv_001');
    expect(chatLink('cnv_001', 'msg_042')).toBe('/inbox/cnv_001?at=msg_042');
    expect(chatLink('tsk_007', 'cmt_013')).toBe('/inbox/tsk_007?at=cmt_013');
  });

  it('reads a message or a comment id from the link, and nothing else', () => {
    expect(messageParam('msg_042')).toBe('msg_042');
    expect(messageParam('cmt_013')).toBe('cmt_013');
    for (const bad of [null, '', 'msg_1', 'tsk_001', 'msg_042x', '<b>']) expect(messageParam(bad)).toBeUndefined();
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


describe('replaceParam', () => {
  /** Runs replaceParam on a link and returns the options it passed and the link that its update gives. */
  function run(link: string, key: string, value: string | null) {
    const setParams = vi.fn();
    replaceParam(setParams, key, value);
    expect(setParams).toHaveBeenCalledTimes(1);
    const [update, options] = setParams.mock.calls[0] as [(current: URLSearchParams) => URLSearchParams, unknown];
    const current = new URLSearchParams(link);
    const next = update(current);
    return { options, next: next.toString(), current: current.toString() };
  }

  it('sets a value and replaces the link, so Back does not step through it', () => {
    const { options, next } = run('tab=files', 'compose', '1');
    expect(options).toEqual({ replace: true });
    expect(next).toBe('tab=files&compose=1');
  });

  it('changes a value that the link has', () => {
    expect(run('tab=tasks&show=open', 'show', 'done').next).toBe('tab=tasks&show=done');
  });

  it('removes the key when the value is null, and keeps the other keys', () => {
    const { options, next } = run('tab=files&file=fil_001', 'file', null);
    expect(options).toEqual({ replace: true });
    expect(next).toBe('tab=files');
  });

  it('leaves the link as it is when it has no such key to remove', () => {
    expect(run('tab=files', 'compose', null).next).toBe('tab=files');
  });

  it('never changes the link that it gets', () => {
    expect(run('tab=files&file=fil_001', 'file', null).current).toBe('tab=files&file=fil_001');
  });
});
