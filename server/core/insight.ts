import { scrubText } from '../../src/lib/urlScrub';
import { requestHost } from './after';
import type { LogFields, Logger } from './ports';

/**
 * Server errors for the owner (insight design, 2026-10-25, section 6). The logger keeps its job: every line still goes to the log.
 * Each `error` line also posts one `$exception` record to PostHog Cloud EU, after the answer. A failed send is dropped and never
 * retried. The send is no database write, so the outbox rule does not apply.
 *
 * The record shape comes from the PostHog capture API (https://posthog.com/docs/api/capture and
 * https://posthog.com/docs/error-tracking/installation/manual): `api_key`, `event`, `distinct_id` at the top, and in `properties` a
 * `$exception_list` of `{ type, value, mechanism }`. A stack trace is left out, because the log line holds none.
 */
export const POSTHOG_CAPTURE_URL = 'https://eu.i.posthog.com/i/v0/e/';

/** A flood of errors (the database is down) sends at most this many records in one minute. The log lines are not cut. */
export const SERVER_SENDS_PER_MINUTE = 60;

/** The error text is cut here. A database error can repeat the values of a row, so a long text carries more risk. */
const MAX_TEXT = 500;
const SEND_TIMEOUT_MS = 5000;
const ANONYMOUS = 'madar-server';

export type InsightLoggerOptions = {
  /** The public PostHog project key (`phc_...`). */
  key: string;
  env: 'production' | 'test';
  fetch?: typeof fetch;
  /** Keeps the send alive after the answer. Default: `requestHost().after`, which is `waitUntil` on both hosts. */
  keep?: (work: Promise<unknown>) => void;
  now?: () => number;
};

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * The text of the record: the message and the error text. An address loses its query and hash. A value that a database error repeats
 * (`Key (name)=(Secret)`) is cut out. The result is short.
 */
function exceptionText(message: string, error: string | undefined): string {
  const whole = error === undefined ? message : `${message} ${error}`;
  return scrubText(whole.replace(/=\([^)]*\)/g, '=(...)')).slice(0, MAX_TEXT);
}

/**
 * Wraps a logger. Only these fields of a line go out: the call name (`name` or `call`), `error`, `personId` and `agentId`. Any other
 * field stays in the log, so a call input or a text that a person wrote never leaves the server.
 */
export function insightLogger(log: Logger, o: InsightLoggerOptions): Logger {
  const now = o.now ?? Date.now;
  const keep = o.keep ?? ((work) => requestHost().after?.(work));
  let minute = -1;
  let sent = 0;

  /** True while this minute has room. */
  const room = (): boolean => {
    const current = Math.floor(now() / 60_000);
    if (current !== minute) {
      minute = current;
      sent = 0;
    }
    if (sent >= SERVER_SENDS_PER_MINUTE) return false;
    sent += 1;
    return true;
  };

  const report = (message: string, fields: LogFields | undefined): void => {
    if (!room()) return;
    const personId = text(fields?.personId);
    const agentId = text(fields?.agentId);
    const call = text(fields?.name) ?? text(fields?.call);
    const body = {
      api_key: o.key,
      event: '$exception',
      distinct_id: personId ?? ANONYMOUS,
      timestamp: new Date(now()).toISOString(),
      properties: {
        $exception_list: [{ type: 'ServerError', value: exceptionText(message, text(fields?.error)), mechanism: { handled: true, synthetic: true } }],
        $exception_source: 'server',
        ...(call ? { call } : {}),
        ...(personId ? { personId } : {}),
        ...(agentId ? { agentId } : {}),
        env: o.env,
        // The record belongs to no person profile, so it costs the cheaper anonymous price.
        $process_person_profile: false,
      },
    };
    const send = o.fetch ?? globalThis.fetch;
    const work = (async () => {
      try {
        const answer = await send(POSTHOG_CAPTURE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(SEND_TIMEOUT_MS) : undefined,
        });
        // A 500 or a refusal is dropped. The body is never read.
        await answer.body?.cancel().catch(() => undefined);
      } catch {
        // A lost record is fine. PostHog is never allowed to break the server.
      }
    })();
    keep(work);
  };

  return {
    info: (message, fields) => log.info(message, fields),
    warn: (message, fields) => log.warn(message, fields),
    error: (message, fields) => {
      log.error(message, fields);
      try {
        report(message, fields);
      } catch {
        // The log line is written. A failed report changes nothing for the caller.
      }
    },
  };
}
