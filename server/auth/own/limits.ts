/**
 * The sign-in limits of the own stack (Supabase exit, wave 2), in rate_limits like the limits of forgot.ts. Each key holds only a
 * sha256 of its email or network address (hashedKey). The address is the one of clientAddress (forgot.ts), which the Worker route
 * reads and passes in.
 */
const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const SIGNIN_WINDOW_MS = 15 * MINUTE_MS;
/**
 * Password sign-ins for one email from one network address in 15 minutes (the key holds the pair): a person who forgot the password tries
 * a few times; a guesser at one address stops at 10. The pair, not the email alone (owner, review 2026-11-10): wrong tries of a stranger
 * at another address do not lock the person out.
 */
export const SIGNIN_PER_EMAIL = 10;
/**
 * All password sign-ins for one email in 15 minutes, from any address: the total stop for a guesser with many addresses. A known address
 * (below) does not count toward it and does not meet it (review 2026-11-10), so 10 addresses of strangers cannot lock the person out.
 */
export const SIGNIN_PER_EMAIL_TOTAL = 100;
/**
 * A known address: the person signed in with the right password from this network address (its /64 block for IPv6) in the last 90 days.
 * The table auth_known_addresses keeps an HMAC of the email with the address, under a key from the server secret (knownKey.ts): a copy of
 * the database cannot check a guess. The address 'unknown' (no address header) never becomes known. A known address still meets its own
 * limit of 10 tries.
 */
export const KNOWN_ADDRESS_DAYS = 90;
/** A sign-in from a known address writes its row again only when the row is older than one day: one row written a day at most. */
export const KNOWN_ADDRESS_TOUCH_MS = 24 * 60 * 60 * 1000;
/** For one network address in 15 minutes: the whole office (about 15 people) can sit behind one address. */
export const SIGNIN_PER_ADDRESS = 30;
/** Link opens (Welcome and Reset) for one address in one hour. */
export const VERIFY_PER_ADDRESS = 20;
/** OAuth client registrations for one address in one hour: each one writes rows of the Free day limit. */
export const REGISTER_PER_ADDRESS = 10;
/**
 * OAuth authorize steps for one address in one hour (review 2026-11-10, finding 1). Each step writes one row of oauth_requests, and
 * the step needs no sign-in, so a flood with one known client id would fill the Free day limit of rows written.
 */
export const AUTHORIZE_PER_ADDRESS = 60;

/**
 * The limit of one network address in a step that runs before a token (Madar enterprises). The step itself counts it on the local path.
 * On the office path the Worker counts it once, in the platform object, before it chooses the enterprise, and passes addressChecked to the
 * step. So one address has one count, whatever the enterprise of the email or of the tag. forgot and renew keep their own limits in
 * forgot.ts and renew.ts.
 */
export const ADDRESS_LIMITS = {
  'auth.password': { prefix: 'signin:ip', limit: { limit: SIGNIN_PER_ADDRESS, windowMs: SIGNIN_WINDOW_MS } },
  'auth.verify': { prefix: 'verify:ip', limit: { limit: VERIFY_PER_ADDRESS, windowMs: HOUR_MS } },
} as const;
