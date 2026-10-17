import type { Deps } from '../../core/ports';
import type { SigningKeys } from './keys';

/** The deps of a sign-in step in the office object (Supabase exit, wave 2): the SQLite Db, the clock, the log, and the keys. */
export type SigninDeps = Pick<Deps, 'db' | 'clock' | 'log' | 'config'> & { keys: SigningKeys };

/** The answer of a browser sign-in: the shape of the Supabase token answer, so the screens port stays small. */
export type TokenAnswer = { access_token: string; token_type: 'bearer'; expires_in: number; refresh_token: string; user: { id: string } };

/** An OAuth refusal (RFC 6749, section 5.2). The OAuth routes answer it as { error, error_description } with its status. */
export class OAuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}
