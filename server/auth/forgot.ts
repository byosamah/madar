import { z } from 'zod';
import { User } from '../../src/api/contract/entities';
import { invalid } from '../../src/api/errors';
import { requestHost, type HostName, type RequestHost } from '../core/after';
import type { Deps, Query } from '../core/ports';
import { errorResponse, runErrorOf } from '../http/errors';
import { sendCounted } from '../mail/quota';
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
 * - Limits, counted before the lookup, so they say nothing about the email: 3 an hour for each email and 10 an hour for each
 *   network address. Over a limit: 429 with Retry-After (the Forgot screen shows "Too many tries"). The keys hold only a sha256.
 * - Office limits, counted after the lookup and only when a mail would go out: 20 reset mails an hour (key forgot:all) and 30 a
 *   UTC day (key forgot:day). The reset mail also counts against the daily mail quota as sign-in mail (sendCounted, N2). So a
 *   flood of resets never uses up the mail of the day (Resend: 100 a day): notices keep their 90, and invitations still go.
 *   Over any of them: no mail, a warning in the log, and the same 200 answer.
 * - For an active person with a sign-in link: a "recovery" link of Auth, and the reset mail in the person's language with a
 *   link to /reset. A person who never got an invitation has no Auth user, and gets nothing: generate_link must only run for
 *   an email that a users row holds (proof.md, P1).
 * - A link that names another Auth user than users.auth_user_id gets no mail and no relink: this route needs no sign-in, so
 *   it never moves a sign-in link (only auth.invite and auth.email do, after an Admin or Management action). It logs a warning.
 * - The idempotency key of the mail is a sha256 of the token hash: the key goes to the mail sender and its logs, and the token
 *   hash is the live sign-in credential.
 * - A failure of Auth or of the mail is logged and gives the same answer.
 * - The network address (clientAddress, task S1): only a value that the host writes, never one that the sender can choose.
 *   Workers: cf-connecting-ip (Cloudflare sets it). Supabase: the LAST x-forwarded-for entry, which the gateway appends.
 *   OPEN PROOF (Z0b, TASKS.md item Z "which header carries the client address"): send a forged x-forwarded-for and a forged
 *   cf-connecting-ip to a probe function on madar-test, log both headers as they arrive, and keep this rule only when the last
 *   entry is the real client address. When the last entry is a proxy address (the same for every client), this limit becomes
 *   one limit for the whole office; then change the rule to the header that the probe names.
 */

export const FORGOT_EMAIL_PER_HOUR = 3;
export const FORGOT_IP_PER_HOUR = 10;
export const FORGOT_OFFICE_PER_HOUR = 20;
export const FORGOT_OFFICE_KEY = 'forgot:all';
export const FORGOT_OFFICE_PER_DAY = 30;
export const FORGOT_DAY_KEY = 'forgot:day';
export const FORGOT_MIN_MS = 1500;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The person with this email (the users.email column is lower case). */
export const FORGOT_PERSON_SQL = "select id, doc, auth_user_id::text as auth from users where email = $1 and kind = 'human'";

const Body = z.object({ email: z.email() });

/** The network address of the sender, from the header that the host writes. No value: 'unknown' (one shared limit). */
export function clientAddress(request: Request, host: HostName): string {
  if (host === 'workers') return request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
  // Supabase (and local runs): the gateway appends the address it saw, so only the last entry is not the sender's own text.
  return request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
}

/** Sends the reset mail when the email belongs to an active person with a sign-in link. Otherwise nothing. */
export async function sendReset(email: string, deps: Deps): Promise<'sent' | 'none'> {
  const [row] = await deps.db.statement<{ id: string; doc: unknown; auth: string | null }>('read', FORGOT_PERSON_SQL, [email.toLowerCase()]);
  if (!row || row.auth === null) return 'none';
  const user = User.parse(row.doc);
  if (!user.active || user.kind !== 'human') return 'none';
  const q: Query = (text, values) => deps.db.statement('write', text, values);
  const now = deps.clock.now();
  const office = await hitLimit(q, { key: FORGOT_OFFICE_KEY, limit: FORGOT_OFFICE_PER_HOUR, windowMs: HOUR_MS, now });
  if (!office.ok) {
    deps.log.warn('A reset mail did not go out: the office reached its limit of reset mails for this hour.', { userId: row.id });
    return 'none';
  }
  const day = await hitLimit(q, { key: FORGOT_DAY_KEY, limit: FORGOT_OFFICE_PER_DAY, windowMs: DAY_MS, now });
  if (!day.ok) {
    deps.log.warn('A reset mail did not go out: the office reached its limit of reset mails for this day.', { userId: row.id });
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
  const sent = await sendCounted(deps, 'signin', { to: user.email, ...mail, tag: 'reset', idempotencyKey: await hashedKey('reset', link.tokenHash) }, { userId: row.id });
  if (sent.status === 'over') {
    deps.log.warn('A reset mail did not go out: the daily mail quota is full.', { userId: row.id });
    return 'none';
  }
  return 'sent';
}

function tooMany(retryAfterMs: number): Response {
  return errorResponse({ code: 'conflict', message: 'Too many tries. Wait a few minutes, then try again.', details: { reason: 'too_many_resets', retryAfterMs } });
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

    const { host, after } = hostOf();
    const q: Query = (text, values) => deps.db.statement('write', text, values);
    const now = deps.clock.now();
    const byAddress = await hitLimit(q, { key: await hashedKey('forgot:ip', clientAddress(request, host)), limit: FORGOT_IP_PER_HOUR, windowMs: HOUR_MS, now });
    if (!byAddress.ok) return tooMany(byAddress.retryAfterMs);
    const byEmail = await hitLimit(q, { key: await hashedKey('forgot:email', email), limit: FORGOT_EMAIL_PER_HOUR, windowMs: HOUR_MS, now });
    if (!byEmail.ok) return tooMany(byEmail.retryAfterMs);

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
