import { TYPING_EVENT, type TypingSignal } from '../../src/api/remote/wire';
import type { Db, Logger, TypingPort } from '../core/ports';

/**
 * The typing signals on Realtime (chat presence design B, base B5). One statement through db.statement: realtime.send for the private
 * topic person:<id> of each person, with the event TYPING_EVENT next to the change signals (server/signal/realtime.ts).
 * db.statement wraps it in a short transaction of its own on its own connection: begin with the timeouts, the select, commit (3 round
 * trips; performance audit SV-14). It never runs inside the transaction of a call. Only the server writes on person: topics, and that
 * stays true. It never throws: a typing signal is not saved, a lost one ends by itself 6 seconds after the last one, and the call that
 * sends it must not fail. An error logs once with the count of people, never their names.
 */
const SEND = 'select realtime.send($1::jsonb, $2::text, t.topic, true) from unnest($3::text[]) as t(topic)';

export function realtimeTyping(o: { db: Db; log: Logger }): TypingPort {
  return {
    async send(people: string[], signal: TypingSignal): Promise<void> {
      if (people.length === 0) return;
      try {
        await o.db.statement('write', SEND, [JSON.stringify(signal), TYPING_EVENT, people.map((id) => `person:${id}`)]);
      } catch (error) {
        o.log.error('A typing signal was not sent.', { people: people.length, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
