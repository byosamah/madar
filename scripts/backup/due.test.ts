import { describe, expect, it } from 'vitest';
import { GITHUB_FRESH_HOURS, MIN_AGE_HOURS, backupDue } from './due';

/**
 * scripts/backup/due.ts: when `mac-backup.sh --if-due` makes the database backup (owner, 2026-10-20). Any session of the owner
 * runs it on each owner message, so the times and the ages decide alone: one backup a day, none while GitHub makes them, and
 * none after October.
 */
const at = (iso: string) => new Date(iso);
const macOnly = (newestBackupAt: string | null) => ({ newestBackupAt, githubSuccessAt: '2026-10-17T01:17:37Z' });

describe('backupDue', () => {
  it('is due after 17:00 Riyadh when the newest backup is a day old and GitHub made none', () => {
    expect(backupDue(at('2026-10-20T14:00:00Z'), macOnly('2026-10-19T14:31:12Z')).due).toBe(true);
    expect(backupDue(at('2026-10-20T20:30:00Z'), macOnly('2026-10-19T14:31:12Z')).due).toBe(true);
  });

  it('is not due in the office hours of Riyadh (08:00 to 17:00), however old the newest backup is', () => {
    for (const time of ['2026-10-20T05:00:00Z', '2026-10-20T09:00:00Z', '2026-10-20T13:59:59Z']) {
      const result = backupDue(at(time), macOnly('2026-10-18T14:30:00Z'));
      expect(result.due, time).toBe(false);
      expect(result.reason, time).toContain('office hours');
    }
  });

  it('is due before 08:00 Riyadh when the evening had no backup', () => {
    expect(backupDue(at('2026-10-21T04:59:00Z'), macOnly('2026-10-19T14:31:12Z')).due).toBe(true);
  });

  it(`is not due when another session made a backup less than ${MIN_AGE_HOURS} hours ago`, () => {
    const result = backupDue(at('2026-10-20T16:00:00Z'), macOnly('2026-10-20T14:31:00Z'));
    expect(result.due).toBe(false);
    expect(result.reason).toContain('1.5 hours old');
  });

  it(`is not due all evening and night when the GitHub backup of the night before worked (less than ${GITHUB_FRESH_HOURS} hours ago)`, () => {
    const github = { newestBackupAt: '2026-10-20T01:46:36Z', githubSuccessAt: '2026-10-20T01:44:54Z' };
    for (const time of ['2026-10-20T14:00:00Z', '2026-10-20T22:00:00Z', '2026-10-21T01:40:00Z']) {
      const result = backupDue(at(time), github);
      expect(result.due, time).toBe(false);
      expect(result.reason, time).toContain('GitHub');
    }
  });

  it('is due again on the evening after a night when GitHub refused its backup', () => {
    const refused = { newestBackupAt: '2026-10-20T01:46:36Z', githubSuccessAt: '2026-10-20T01:44:54Z' };
    expect(backupDue(at('2026-10-21T14:00:00Z'), refused).due).toBe(true);
  });

  it('is due when no database backup is found, or its time does not read', () => {
    expect(backupDue(at('2026-10-20T15:00:00Z'), { newestBackupAt: null, githubSuccessAt: null }).due).toBe(true);
    expect(backupDue(at('2026-10-20T15:00:00Z'), { newestBackupAt: 'not a time', githubSuccessAt: 'not a time' }).due).toBe(true);
  });

  it('stops with October 2026: the evening of 31 October is the last, and 1 November in Riyadh is never due (owner, 2026-10-20)', () => {
    expect(backupDue(at('2026-10-31T14:30:00Z'), macOnly('2026-10-30T14:30:00Z')).due).toBe(true);
    for (const time of ['2026-10-31T21:00:00Z', '2026-11-01T15:00:00Z', '2026-12-05T15:00:00Z']) {
      const result = backupDue(at(time), macOnly('2026-10-31T14:30:00Z'));
      expect(result.due, time).toBe(false);
      expect(result.reason, time).toContain('October');
    }
  });
});
