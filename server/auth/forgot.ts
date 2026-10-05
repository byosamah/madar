import { z } from 'zod';
import { User } from '../../src/api/contract/entities';
import { personName } from '../../src/lib/personName';
import { invalid } from '../../src/api/errors';
import { requestHost, type RequestHost } from '../core/after';
import type { Deps, Query } from '../core/ports';
import { errorResponse, runErrorOf } from '../http/errors';
import { reserve, sendCounted } from '../mail/quota';
import { renderSigninMail, signinLink } from './mail';
import { hashedKey, hitLimit } from './rateLimit';

/**
 * POST /api/auth/forgot { email } (plan 5.1; task P2). The Forgot screen sends it with no sign-in.
 *
 * - The same answer, { v: 1, ok: true } with 200, for every valid email: a person, an unknown email, a turned-off person, an agent.
 * - The time of the answer (task S1): the lookup, the Auth link and the send can take seconds for a real person. So when the
 *   host gives an after (server/core/after.ts: ctx.waitUntil on Workers, EdgeRuntime.waitUntil on Supabase), the route answers
 *   first and does that work after the answer. With no after (tests, local runs) the work stays inline. Either way the answer
 *   waits until it took at least minMs (1.5 s).
 * - Limits, counted before the lookup, so they say nothing about the email: 3 in one window for each email, and 10 an hour
 *   for each network address. Over a limit: 429 with Retry-After. The two limits have their own reasons: too_many_resets_email
 *   (the person already holds reset mails, so the screen says to use the newest one) and too_many_resets (the address; the
 *   screen says to wait a few minutes). The keys hold only a sha256.
 * - The window of each email is no longer than the life of a reset link (otp_expiry in supabase/config.toml and in the Auth
 *   settings of the hosted projects): Auth keeps only the newest recovery token, so the newest mailed link must still work until
 *   the window ends and the person can ask again. The window is 1 hour; a test reads config.toml and fails when the window gets
 *   longer than the link life. otp_expiry is 3600 s, the Auth default, in config.toml and in the hosted projects (security fix
 *   7): Auth has one life for every email link, so a longer one would also keep a reset link alive for longer. An invitation
 *   that is out of date asks for a new link on the Welcome screen instead (server/auth/renew.ts).
 * - No limit for the whole office (S1 security review): an office-wide cap lets one outsider who knows about 10 staff emails use
 *   up the reset mail of everyone for the day. A flood only sends reset mails to the mailboxes it names, which then hold a
 *   working link.
 * - The reset mail counts against the daily mail quota as sign-in mail (N2). The place in the quota comes first, before Auth
 *   makes a link: a full day makes no recovery link (a new one would end the link that the person got earlier that day), sends
 *   no mail, logs a warning, and gives the same 200 answer.
 * - For an active person with a sign-in link: a "recovery" link of Auth, and the reset mail in the person's language with a
 *   link to /reset. A person who never got an invitation has no Auth user, and gets nothing: generate_link must only run for
 *   an email that a users row holds (proof.md, P1).
 * - A link that names another Auth user than users.auth_user_id gets no mail and no relink: this route needs no sign-in, so
 *   it never moves a sign-in link (only auth.invite and auth.email do, after an Admin or Management action). It logs a warning.
 * - The idempotency key of the mail, which is also its place in the quota, is a sha256 of the person and a random id: it exists
 *   before the link, and it never holds the token hash, the live sign-in credential (the key goes to the mail sender and its
 *   logs).
 * - A failure of Auth or of the mail is logged and gives the same answer.
 * - The network address (clientAddress, task S1): cf-connecting-ip, on both hosts. Proven on madar-test (2026-10-04, probe
 *   function, Z0b): Supabase Edge Functions sit behind Cloudflare too; cf-connecting-ip holds the real client address, and
 *   Cloudflare refuses a request that sends its own (error code 1000). x-forwarded-for arrives as "client, client, proxy": its
 *   last entry is a rotating proxy address, so reading it puts many clients under one limit. true-client-ip passes through
 *   forged. So the route never reads either. No cf-connecting-ip (local runs only): 'unknown'.
 */

const HOUR_MS = 60 * 60 * 1000;
export const FORGOT_EMAIL_PER_WINDOW = 3;
/** No longer than the life of a reset link (otp_expiry, in config.toml and in each hosted project): see the comment above. */
export const FORGOT_EMAIL_WINDOW_MS = HOUR_MS;
export const FORGOT_IP_PER_HOUR = 10;
export const FORGOT_MIN_MS = 1500;

/** The person with this email (the users.email column is lower case). */
export const FORGOT_PERSON_SQL = "select id, doc, auth_user_id::text as auth from users where email = $1 and kind = 'human'";

const Body = z.object({ email: z.email() });

/** The network address of the sender: the value that Cloudflare writes in front of both hosts. None (local runs): 'unknown'. */
export function clientAddress(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

/** Sends the reset mail when the email belongs to an active person with a sign-in link. Otherwise nothing. */
export async function sendReset(email: string, deps: Deps): Promise<'sent' | 'none'> {
  const [row] = await deps.db.statement<{ id: string; doc: unknown; auth: string | null }>('read', FORGOT_PERSON_SQL, [email.toLowerCase()]);
  if (!row || row.auth === null) return 'none';
  const user = User.parse(row.doc);
  if (!user.active || user.kind !== 'human') return 'none';
  // The place in the quota before the link: a full day must not end the link that the person got earlier.
  const key = await hashedKey('reset', `${row.id}:${crypto.randomUUID()}`);
  const now = deps.clock.now();
  if ((await deps.db.tx('write', (q) => reserve(q, 'signin', key, { now, userId: row.id }))) === 'over') {
    deps.log.warn('A reset mail did not go out: the daily mail quota is full.', { userId: row.id });
    return 'none';
  }
  const link = await deps.authAdmin.generateLink('recovery', user.email);
  if (link.authUserId !== row.auth) {
    deps.log.warn('A reset mail did not go out: the recovery link names another Auth user than the sign-in link.', { userId: row.id });
    return 'none';
  }
  const mail = renderSigninMail('reset', user.preferences.language, {
    name: personName(user, user.preferences.language), link: signinLink(deps.config.appUrl, 'reset', link.tokenHash, 'recovery'),
  }, user.gender, { appUrl: deps.config.appUrl });
  // sendCounted finds the place that this key holds.
  const sent = await sendCounted(deps, 'signin', { to: user.email, ...mail, tag: 'reset', idempotencyKey: key }, { userId: row.id });
  if (sent.status === 'over') {
    deps.log.warn('A reset mail did not go out: the daily mail quota is full.', { userId: row.id });
    return 'none';
  }
  return 'sent';
}

/** Over the limit of the network address. */
function tooMany(retryAfterMs: number): Response {
  return errorResponse({ code: 'conflict', message: 'Too many tries. Wait a few minutes, then try again.', details: { reason: 'too_many_resets', retryAfterMs } });
}

/** Over the limit of one email: reset mails already went to it, and the newest one still works. */
function tooManyForEmail(retryAfterMs: number): Response {
  return errorResponse({
    code: 'conflict',
    message: 'You already asked for reset links for this email. Use the newest reset email, or try again later.',
    details: { reason: 'too_many_resets_email', retryAfterMs },
  });
}

export function createForgotRoute(o: { minMs?: number; sleep?: (ms: number) => Promise<void>; host?: () => RequestHost } = {}) {
  const minMs = o.minMs ?? FORGOT_MIN_MS;
  const hostOf = o.host ?? requestHost;
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

    const { after } = hostOf();
    const q: Query = (text, values) => deps.db.statement('write', text, values);
    const now = deps.clock.now();
    const byAddress = await hitLimit(q, { key: await hashedKey('forgot:ip', clientAddress(request)), limit: FORGOT_IP_PER_HOUR, windowMs: HOUR_MS, now });
    if (!byAddress.ok) return tooMany(byAddress.retryAfterMs);
    const byEmail = await hitLimit(q, { key: await hashedKey('forgot:email', email), limit: FORGOT_EMAIL_PER_WINDOW, windowMs: FORGOT_EMAIL_WINDOW_MS, now });
    if (!byEmail.ok) return tooManyForEmail(byEmail.retryAfterMs);

    const work = sendReset(email, deps).catch((error: unknown) => {
      deps.log.warn('A reset mail did not go out.', { error: error instanceof Error ? error.message : String(error) });
    });
    if (after) after(work);
    else await work;
    const spent = performance.now() - started;
    if (spent < minMs) await sleep(minMs - spent);
    return Response.json({ v: 1, ok: true });
  };
}

/** The route that server/http/routes.ts mounts. */
export const forgotRoute: (request: Request, deps: Deps) => Promise<Response> = createForgotRoute();
