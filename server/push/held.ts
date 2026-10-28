import type { Deps } from '../core/ports';
import { isQuietNow } from '../core/quiet';
import { isLite } from '../data/dialect';
import type { ChatRow } from '../../src/api/contract/views';
import type { NoticeView } from '../../src/lib/noticeSentence';
import { runCall } from '../core/runCall';
import { devicesOf, postToDevices, releaseDevices } from './notify';
import { PushSendError } from './send';
import type { LineOptions } from './line';

/**
 * The quiet end (owner, 2026-10-22, fbk_048). A push for a person in quiet hours is not sent: the push effects mark the devices held
 * (heldAt, server/push/notify.ts). This step runs in the 15-minute job. For each person with a held device who is no longer in quiet
 * hours, it sends ONE push with the fixed line ("You have something new in Madar.") to each device, then clears the mark. It sends
 * nothing when the person has nothing unread any more (no unread bell notice and no unread chat or task thread: the person read it at
 * night), and still clears the mark. A push service that fails keeps the mark of that device, so the next run tries again; the other
 * people are handled first. The bell and the Inbox collected everything while the person was quiet.
 */

/** The people with a held device, oldest id first. */
export const HELD_PEOPLE_SQL = "select distinct user_id from push_devices where doc->>'heldAt' is not null order by user_id";
export const HELD_PEOPLE_LITE = "select distinct user_id from push_devices where json_extract(doc, '$.heldAt') is not null order by user_id";

/**
 * True when the person has something unread, read AS the person with the calls of the screens: an unread notice that is no copy for an
 * Admin (a copy sends no push) and does not read as gone, or an unread chat or task thread (the list holds only what the person may
 * open). A person who lost the view of a project since the push was held has nothing unread in it. A read that fails counts as unread:
 * the wrong answer is a push.
 */
async function hasUnread(deps: Deps, userId: string, o: LineOptions): Promise<boolean> {
  const run = o.run ?? deps.runCall ?? runCall;
  const read = async <T>(name: string, input: unknown): Promise<T | null> => {
    const result = await run(deps, { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
    return result.ok ? (result.output as T) : null;
  };
  try {
    const notices = await read<NoticeView[]>('notifications.list', { unreadOnly: true });
    if (notices === null) return true;
    // A notice that reads as gone (its project is hidden from the person, or its item is deleted) is no unread item (tsk_439).
    if (notices.some((one) => !one.notification.read && one.notification.forUserIds === undefined && !one.gone)) return true;
    const chats = await read<ChatRow[]>('chats.list', {});
    return chats === null || chats.some((row) => row.unread > 0 && !row.archived);
  } catch {
    return true;
  }
}

export type HeldReport = { held: number; pushed: number; cleared: number };

export async function releaseHeld(deps: Deps, at: Date, o: LineOptions = {}): Promise<HeldReport> {
  const rows = await deps.db.statement<{ user_id: string }>('write', isLite(deps.db) ? HELD_PEOPLE_LITE : HELD_PEOPLE_SQL);
  const report: HeldReport = { held: rows.length, pushed: 0, cleared: 0 };
  let failed = 0;
  for (const { user_id: userId } of rows) {
    if (await isQuietNow(deps.db, userId, at)) continue;
    try {
      const devices = await devicesOf(deps, userId);
      if (devices.length > 0 && await hasUnread(deps, userId, o)) {
        await postToDevices(deps, devices, null);
        report.pushed += 1;
      }
      await releaseDevices(deps, userId);
      report.cleared += 1;
    } catch (error) {
      if (!(error instanceof PushSendError)) throw error;
      failed += 1;
      deps.log.warn('A held push did not go out. The next run tries again.', { userId, status: error.status });
    }
  }
  if (failed > 0) throw new Error(`The held push did not reach ${failed} ${failed === 1 ? 'person' : 'people'}. The next run tries again.`);
  return report;
}
