import type { Mail } from '../core/ports';
import type { RunRequest, RunResult } from '../core/types';

/**
 * The person who types the code (db mode and lite mode). An agent act on the list of the email code guard (server/mcp/guard.ts) stops
 * with confirm_needed and mails a code to the person. The API tests check the rights of the act, not the code, so the mirror plays
 * the person: it reads the code from the mail that went out and sends the same call again with confirmCode. The code rules have their
 * own tests (guard.lite.test.ts, server/it/confirms.it.test.ts). A call that is no guarded act, or has no mail, is not touched.
 */
export async function runWithCode(run: (req: RunRequest) => Promise<RunResult>, req: RunRequest, sent: readonly Mail[]): Promise<RunResult> {
  const first = await run(req);
  if (first.ok || first.error.details?.reason !== 'confirm_needed') return first;
  const { CONFIRM_FIELD, guardApplies } = await import('../mcp/guard');
  if (!guardApplies(req.name, req.principal)) return first;
  const mail = [...sent].reverse().find((one) => one.tag === 'confirm');
  const code = mail?.text.match(/^\d{6}$/m)?.[0];
  if (!code || req.input === null || typeof req.input !== 'object') return first;
  return run({ ...req, input: { ...(req.input as Record<string, unknown>), [CONFIRM_FIELD]: code } });
}
