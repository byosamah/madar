import type { Logger, LogFields, MeterPort, Query, SignalPort } from '../core/ports';
import type { ChangeSignal } from '../core/types';
import { onNotice, type DbNotice } from '../data/sql';

/**
 * The change signals on Realtime (plan 5.3; task N1.1). Inside the save transaction, one statement runs realtime.send for each
 * signal of the save: the office signal on the private topic "office", and each person signal on "person:<userId>". A rollback
 * sends nothing (proof.md, N1.0). All signals of a save go in one statement, so the office lock waits for one round trip only.
 *
 * realtime.send catches every error of its insert and raises only a WARNING (WarnSendingBroadcastMessage), so its statement
 * succeeds also when nothing was sent (proof.md, Z0a item 5). The sender listens to the notices of its statement and counts
 * each warning as a failed signal: it logs the warning and reports it to the meter. The save still commits; the next signal on
 * that channel shows a gap in seq, and the screens reload (plan 5.3, Gaps). Supabase grants and policies:
 * supabase/migrations/20261004000200_platform_realtime.sql.
 */

/** The broadcast event of every change signal. src/app/remote/channel.ts (track R2) listens to this event. */
export const SIGNAL_EVENT = 'changed';

const SEND = `select realtime.send(s.item->'payload', $2::text, s.item->>'topic', true)
  from jsonb_array_elements($1::jsonb) with ordinality as s(item, n)
  order by s.n`;

/** Starts to hear the notices on the connection of q; returns the stop, or undefined when q has no connection to hear. */
export type NoticeListen = (q: Query, listener: (notice: DbNotice) => void) => (() => void) | undefined;

/** A meter that counts the failed signals. MeterPort gains signalsFailed in the merge of track N1; track M fills it. */
export type SignalMeter = MeterPort & { signalsFailed?(count: number): void };

export type RealtimeSenderOptions = {
  log: Logger;
  meter?: SignalMeter;
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
        if (notice.severity === 'WARNING') warnings.push(notice.message);
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
      o.meter?.signalsFailed?.(warnings.length);
    },
  };
}

/** One JSON line for each message, as consoleLogger of server/core/deps.ts writes them. */
const jsonLog: Logger = {
  info: (message: string, fields?: LogFields) => console.log(JSON.stringify({ level: 'info', message, ...fields })),
  warn: (message: string, fields?: LogFields) => console.warn(JSON.stringify({ level: 'warn', message, ...fields })),
  error: (message: string, fields?: LogFields) => console.error(JSON.stringify({ level: 'error', message, ...fields })),
};

/**
 * The sender of the server's Deps. It logs a failed signal as a JSON line. server/core/deps.ts builds realtimeSender with its
 * own logger and meter once the merge lead patch of track N1 is in.
 */
export const realtimeSignalPort: SignalPort = realtimeSender({ log: jsonLog });
