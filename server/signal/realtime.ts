import type { Logger, Query, SignalPort } from '../core/ports';
import type { ChangeSignal } from '../core/types';
import { onNotice, type DbNotice } from '../data/sql';

/**
 * The change signals on Realtime (plan 5.3; task N1.1). Inside the save transaction, one statement runs realtime.send for each
 * signal of the save: the office signal on the private topic "office", and each person signal on "person:<userId>". A rollback
 * sends nothing (proof.md, N1.0). All signals of a save go in one statement, so the office lock waits for one round trip only.
 *
 * realtime.send catches every error of its insert and raises only a WARNING (WarnSendingBroadcastMessage), so its statement
 * succeeds also when nothing was sent (proof.md, Z0a item 5). The sender listens to the notices of its statement and counts
 * each such warning as a failed signal: it logs the warning. The save still commits; the next signal on
 * that channel shows a gap in seq, and the screens reload (plan 5.3, Gaps). Supabase grants and policies:
 * supabase/migrations/20261004000200_platform_realtime.sql.
 */

/** The broadcast event of every change signal. src/app/remote/channel.ts (track R2) listens to this event. */
export const SIGNAL_EVENT = 'changed';

const SEND = `select realtime.send(s.item->'payload', $2::text, s.item->>'topic', true)
  from jsonb_array_elements($1::jsonb) with ordinality as s(item, n)
  order by s.n`;

/**
 * The start of the warning text of realtime.send (proof.md, Z0a). Postgres never translates the text of RAISE WARNING, but it
 * translates the severity word with lc_messages, so the sender matches the text and not the severity.
 */
const SEND_WARNING = 'WarnSendingBroadcastMessage:';

/** Starts to hear the notices on the connection of q; returns the stop, or undefined when q has no connection to hear. */
export type NoticeListen = (q: Query, listener: (notice: DbNotice) => void) => (() => void) | undefined;

export type RealtimeSenderOptions = {
  log: Logger;
  /** onNotice of pgDb by default. Unit tests pass their own. */
  listen?: NoticeListen;
};

export function realtimeSender(o: RealtimeSenderOptions): SignalPort {
  const listen = o.listen ?? onNotice;
  return {
    async send(q: Query, signals: ChangeSignal[]): Promise<void> {
      if (signals.length === 0) return;
      const warnings: string[] = [];
      const stop = listen(q, (notice) => {
        if (notice.message.startsWith(SEND_WARNING)) warnings.push(notice.message);
      });
      try {
        await q(SEND, [JSON.stringify(signals.map((signal) => ({ topic: signal.channel, payload: signal }))), SIGNAL_EVENT]);
      } finally {
        stop?.();
      }
      if (warnings.length === 0) return;
      o.log.error('A change signal was not sent: realtime.send gave a warning. The screens reload at the next signal, which shows the gap.', {
        failed: warnings.length,
        channels: signals.map((signal) => signal.channel),
        seqs: signals.map((signal) => signal.seq),
        warnings,
      });
    },
  };
}
