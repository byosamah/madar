import { notBuiltAsync } from '../core/notBuilt';

/**
 * The browser token check (plan 5.1): jose against the JWKS, issuer ${SUPABASE_URL}/auth/v1, aud 'authenticated',
 * and a refusal of any token with client_id. Track P replaces this stub.
 */
export function verifyBrowserToken(_header: string | null): Promise<{ authUserId: string }> {
  return notBuiltAsync('The token check');
}
