import { describe, expect, it } from 'vitest';
import { RUN_GAP_MS, runStarts, type RunItem } from './runs';

const at = (hm: string, day = '2026-09-29') => `${day}T${hm}:00.000+03:00`;
const item = (id: string, authorId: string, createdAt: string, extra: Partial<RunItem> = {}): RunItem =>
  ({ id, author: { id: authorId, kind: 'human' }, createdAt, ...extra });
const starts = (items: RunItem[], breakBefore?: string) => [...runStarts(items, breakBefore)];

describe('runs of one person (design item 2)', () => {
  it('joins the messages of one person when each comes within 5 minutes of the one before', () => {
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_002', at('10:03')), item('c', 'usr_002', at('10:07'))])).toEqual(['a']);
  });
  it('counts 5 minutes as the same run, and 5 minutes and 1 second as a new run', () => {
    expect(RUN_GAP_MS).toBe(300_000);
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_002', at('10:05'))])).toEqual(['a']);
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_002', '2026-09-29T10:05:01.000+03:00')])).toEqual(['a', 'b']);
  });
  it('starts a new run for another person, after a quiet line or a reason line, and on a new office day', () => {
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_004', at('10:01'))])).toEqual(['a', 'b']);
    expect(starts([item('a', 'usr_002', at('10:00')), item('l', 'usr_002', at('10:01'), { line: {} }), item('b', 'usr_002', at('10:02'))])).toEqual(['a', 'l', 'b']);
    expect(starts([item('a', 'usr_002', at('10:00')), item('r', 'usr_002', at('10:01'), { reason: {} }), item('b', 'usr_002', at('10:02'))])).toEqual(['a', 'r', 'b']);
    expect(starts([item('a', 'usr_002', at('23:58', '2026-09-28')), item('b', 'usr_002', at('00:01'))])).toEqual(['a', 'b']);
  });
  it('gives each agent message its own run, and starts a run after it', () => {
    const agent = (id: string, time: string): RunItem => ({ id, author: { id: 'usr_090', kind: 'agent' }, createdAt: at(time) });
    expect(starts([agent('a', '10:00'), agent('b', '10:01'), item('c', 'usr_090', at('10:02'))])).toEqual(['a', 'b', 'c']);
  });
  it('starts a run at the message under the New line', () => {
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_002', at('10:01'))], 'b')).toEqual(['a', 'b']);
  });
});
