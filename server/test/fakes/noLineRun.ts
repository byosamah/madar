import type { RunCall } from '../../core/runCall';

/**
 * A run of the read calls that always fails with the code "failed". A push test that does not test the line passes it as deps.runCall:
 * the line then reads as an error (neither a line nor GONE, see server/push/line.ts), so the push effect sends the empty push, and the
 * test needs no office behind the line. It makes no statement and no log line.
 */
export const noLineRun: RunCall = async () => ({ ok: false, error: { code: 'failed', message: 'This test makes no line.' } }) as never;
