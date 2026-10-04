import { z } from 'zod';
import { User } from '../../src/api/contract/entities';
import { invalid } from '../../src/api/errors';
import type { Deps, Query } from '../core/ports';
import { errorResponse, runErrorOf } from '../http/errors';
import { renderSigninMail, signinLink } from './mail';
import { hashedKey, hitLimit } from './rateLimit';

/**
 * POST /api/auth/forgot { email } (plan 5.1; task P2). The Forgot screen sends it with no sign-in.
 *
 * - The same answer, { v: 1, ok: true } with 200, for every valid email: a person, an unknown email, a turned-off person, an agent.
 *   The answer also waits until it took at least minMs (1.5 s), so its time does not tell either.
 * - Limits, counted before the lookup, so they say nothing about the email: 3 an hour for each email and 10 an hour for each
 *   network address. Over a limit: 429 with Retry-After (the Forgot screen shows "Too many tries"). The keys hold only a sha256.
 * - An office limit of 20 reset mails an hour (key forgot:all), counted after the lookup and only when a mail would go out.
 *   A client can forge the address on Supabase, so this keeps a script from using up the mail of the day (Resend: 100 a day)
 *   by sending 3 an hour to every person. Over it: no mail, a warning in the log, and the same 200 answer.
 * - For an active person with a sign-in link: a "recovery" link of Auth, and the reset mail in the person's language with a
 *   link to /reset. A person who never got an invitation has no Auth user, and gets nothing: generate_link must only run for
 *   an email that a users row holds (proof.md, P1).
 * - A link that names another Auth user than users.auth_user_id gets no mail and no relink: this route needs no sign-in, so
 *   it never moves a sign-in link (only auth.invite and auth.email do, after an Admin or Management action). It logs a warning.
 * - The idempotency key of the mail is a sha256 of the token hash: the key goes to the mail sender and its logs, and the token
 *   hash is the live sign-in credential.
 * - A failure of Auth or of the mail is logged and gives the same answer.
 * - The network address: cf-connecting-ip on Cloudflare, else the first x-forwarded-for entry (the client, on Supabase).
 *   A client can set that entry on Supabase; track Z checks on madar-test which entry the platform adds.
 */

export const FORGOT_EMAIL_PER_HOUR = 3;
export const FORGOT_IP_PER_HOUR = 10;
export const FORGOT_OFFICE_PER_HOUR = 20;
export const FORGOT_OFFICE_KEY = 'forgot:all';
export const FORGOT_MIN_MS = 1500;
const HOUR_MS = 60 * 60 * 1000;

/** The person with this email (the users.email column is lower case). */
export const FORGOT_PERSON_SQL = "select id, doc, auth_user_id::text as auth from users where email = $1 and kind = 'human'";

const Body = z.object({ email: z.email() });

export function clientAddress(request: Request): string {
  const cloudflare = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflare) return cloudflare;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

/** Sends the reset mail when the email belongs to an active person with a sign-in link. Otherwise nothing. */
export async function sendReset(email: string, deps: Deps): Promise<'sent' | 'none'> {
  const [row] = await deps.db.statement<{ id: string; doc: unknown; auth: string | null }>('read', FORGOT_PERSON_SQL, [email.toLowerCase()]);
  if (!row || row.auth === null) return 'none';
  const user = User.parse(row.doc);
  if (!user.active || user.kind !== 'human') return 'none';
  const q: Query = (text, values) => deps.db.statement('write', text, values);
  const office = await hitLimit(q, { key: FORGOT_OFFICE_KEY, limit: FORGOT_OFFICE_PER_HOUR, windowMs: HOUR_MS, now: deps.clock.now() });
  if (!office.ok) {
    deps.log.warn('A reset mail did not go out: the office reached its limit of reset mails for this hour.', { userId: row.id });
    return 'none';
  }
  const link = await deps.authAdmin.generateLink('recovery', user.email);
  if (link.authUserId !== row.auth) {
    deps.log.warn('A reset mail did not go out: the recovery link names another Auth user than the sign-in link.', { userId: row.id });
    return 'none';
  }
  const mail = renderSigninMail('reset', user.preferences.language, {
    name: user.name, link: signinLink(deps.config.appUrl, 'reset', link.tokenHash, 'recovery'),
  }, user.gender);
  await deps.mail.send({ to: user.email, ...mail, tag: 'reset', idempotencyKey: await hashedKey('reset', link.tokenHash) });
  return 'sent';
}

function tooMany(retryAfterMs: number): Response {
  return errorResponse({ code: 'conflict', message: 'Too many tries. Wait a few minutes, then try again.', details: { reason: 'too_many_resets', retryAfterMs } });
}

export function createForgotRoute(o: { minMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  const minMs = o.minMs ?? FORGOT_MIN_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async function forgotRoute(request: Request, deps: Deps): Promise<Response> {
    const started = performance.now();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const parsed = Body.safeParse(body);
    if (!parsed.success) return errorResponse(runErrorOf(invalid('email', 'Type a valid email.')));
    const email = parsed.data.email.trim().toLowerCase();

    const q: Query = (text, values) => deps.db.statement('write', text, values);
    const now = deps.clock.now();
    const byAddress = await hitLimit(q, { key: await hashedKey('forgot:ip', clientAddress(request)), limit: FORGOT_IP_PER_HOUR, windowMs: HOUR_MS, now });
    if (!byAddress.ok) return tooMany(byAddress.retryAfterMs);
    const byEmail = await hitLimit(q, { key: await hashedKey('forgot:email', email), limit: FORGOT_EMAIL_PER_HOUR, windowMs: HOUR_MS, now });
    if (!byEmail.ok) return tooMany(byEmail.retryAfterMs);

    try {
      await sendReset(email, deps);
    } catch (error) {
      deps.log.warn('A reset mail did not go out.', { error: error instanceof Error ? error.message : String(error) });
    }
    const spent = performance.now() - started;
    if (spent < minMs) await sleep(minMs - spent);
    return Response.json({ v: 1, ok: true });
  };
}

/** The route that server/http/routes.ts mounts. */
export const forgotRoute: (request: Request, deps: Deps) => Promise<Response> = createForgotRoute();
