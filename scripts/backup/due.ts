import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * When the Mac database backup is due (owner, 2026-10-20; .github/CLAUDE.md). Each session of the owner runs
 * `mac-backup.sh --if-due` on each owner message, so the backup does not wait for one open session. The backup is due outside
 * the office hours of Riyadh, when GitHub made no backup in the last GITHUB_FRESH_HOURS, when the newest database backup is
 * MIN_AGE_HOURS old or more, and only until the end of October 2026.
 *
 *   npx tsx scripts/backup/due.ts <newest madar-db publishedAt> <newest successful DB backup run createdAt>
 *   (an empty argument for none) prints "due: ..." or "not due: ..."
 */

/** 08:00 to 17:00 in Riyadh (UTC+3, no summer time). The backup holds the office lock for a few seconds. */
export const OFFICE_HOURS_UTC = { from: 5, to: 14 } as const;
/** Less than a day, so the backup of the evening before never stops the next one. More than half a day, so two sessions make one. */
export const MIN_AGE_HOURS = 18;
/** db-backup.yml runs each night near 01:00 UTC. Its good run covers the evening and the night after it, a little late included. */
export const GITHUB_FRESH_HOURS = 26;
/** 2026-11-01 00:00 in Riyadh: the Mac backups end with October (owner, 2026-10-20). */
export const END = Date.parse('2026-10-31T21:00:00Z');

/** The hours from a time to now: NaN when there is no time or it does not read. */
function hoursSince(now: Date, iso: string | null): number {
  return (now.getTime() - (iso === null ? Number.NaN : Date.parse(iso))) / 3_600_000;
}

export function backupDue(
  now: Date,
  last: { newestBackupAt: string | null; githubSuccessAt: string | null },
): { due: boolean; reason: string } {
  if (now.getTime() >= END) {
    return { due: false, reason: 'the Mac backups ended with October 2026 (owner, 2026-10-20). db-backup.yml makes them on GitHub.' };
  }
  const hour = now.getUTCHours();
  if (hour >= OFFICE_HOURS_UTC.from && hour < OFFICE_HOURS_UTC.to) {
    return { due: false, reason: 'office hours in Riyadh (08:00 to 17:00). The backup waits until 17:00.' };
  }
  const github = hoursSince(now, last.githubSuccessAt);
  if (github < GITHUB_FRESH_HOURS) {
    return { due: false, reason: `GitHub made the backup ${github.toFixed(1)} hours ago (db-backup.yml).` };
  }
  const age = hoursSince(now, last.newestBackupAt);
  if (Number.isNaN(age)) return { due: true, reason: 'no database backup with a time was found.' };
  const line = `the newest database backup is ${age.toFixed(1)} hours old.`;
  return age < MIN_AGE_HOURS ? { due: false, reason: line } : { due: true, reason: line };
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const { due, reason } = backupDue(new Date(), {
    newestBackupAt: process.argv[2] || null,
    githubSuccessAt: process.argv[3] || null,
  });
  console.log(`${due ? 'due' : 'not due'}: ${reason}`);
}
