/**
 * The sign-in limits of the own stack (Supabase exit, wave 2), in rate_limits like the limits of forgot.ts. Each key holds only a
 * sha256 of its email or network address (hashedKey). The address is the one of clientAddress (forgot.ts), which the Worker route
 * reads and passes in.
 */
const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const SIGNIN_WINDOW_MS = 15 * MINUTE_MS;
/** Password sign-ins for one email in 15 minutes: a person who forgot the password tries a few times; a guesser stops at 10. */
export const SIGNIN_PER_EMAIL = 10;
/** For one network address in 15 minutes: the whole office (about 15 people) can sit behind one address. */
export const SIGNIN_PER_ADDRESS = 30;
/** Link opens (Welcome and Reset) for one address in one hour. */
export const VERIFY_PER_ADDRESS = 20;
/** OAuth client registrations for one address in one hour: each one writes rows of the Free day limit. */
export const REGISTER_PER_ADDRESS = 10;
