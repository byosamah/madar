import { describe, expect, it } from 'vitest';
import type { MeetingRow } from '../../api/contract/views';
import { groupMeetings } from './groups';

/** A row with only the fields that the groups read. */
const row = (id: string, day: string, time = '10:00'): MeetingRow => ({ id, startsAt: `${day}T${time}:00.000+03:00` } as MeetingRow);

describe('groupMeetings', () => {
  // 2026-10-21 is a Wednesday. The office week runs Sunday 2026-10-18 to Saturday 2026-10-24.
  const today = '2026-10-21';

  it('puts a meeting of today first, then this week, then later', () => {
    const { groups } = groupMeetings([row('mtg_001', '2026-10-21'), row('mtg_002', '2026-10-22'), row('mtg_003', '2026-10-24'), row('mtg_004', '2026-10-25')], today);
    expect(groups.map((group) => [group.group, group.rows.map((one) => one.id)])).toEqual([
      ['today', ['mtg_001']], ['week', ['mtg_002', 'mtg_003']], ['later', ['mtg_004']],
    ]);
  });

  it('leaves out a group with no meeting', () => {
    expect(groupMeetings([row('mtg_001', '2026-10-30')], today).groups.map((group) => group.group)).toEqual(['later']);
    expect(groupMeetings([], today)).toEqual({ earlier: [], groups: [] });
  });

  it('keeps the earlier days apart, the newest first', () => {
    const { earlier, groups } = groupMeetings([row('mtg_001', '2026-10-15'), row('mtg_002', '2026-10-20'), row('mtg_003', '2026-10-21')], today);
    expect(earlier.map((one) => one.id)).toEqual(['mtg_002', 'mtg_001']);
    expect(groups.map((group) => group.group)).toEqual(['today']);
  });

  it('counts the coming Sunday to Saturday as this week on a Friday and a Saturday', () => {
    // 2026-10-23 is a Friday: the week left is days off, so the next Sunday to Saturday is "this week".
    const { groups } = groupMeetings([row('mtg_001', '2026-10-25'), row('mtg_002', '2026-10-31'), row('mtg_003', '2026-11-01')], '2026-10-23');
    expect(groups.map((group) => [group.group, group.rows.map((one) => one.id)])).toEqual([['week', ['mtg_001', 'mtg_002']], ['later', ['mtg_003']]]);
  });

  it('uses the office day of a late start', () => {
    // 23:30 in Riyadh is 20:30 UTC on the same office day.
    const { groups } = groupMeetings([row('mtg_001', '2026-10-21', '23:30')], today);
    expect(groups[0].group).toBe('today');
  });
});
