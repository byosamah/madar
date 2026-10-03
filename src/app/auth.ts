/**
 * Sign-in for the screens (client map 7). Track U writes the Supabase version in src/app/remote/auth.ts.
 * The prototype has no sign-in: it is always signed in, as the person chosen in Preview as.
 */
export type AuthStatus = 'signed_in' | 'signed_out';
export type LinkType = 'invite' | 'recovery';

export interface AuthPort {
  status(): AuthStatus;
  /** Called when the status changes, for example when the session ends. */
  subscribe(listener: (status: AuthStatus) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** others: sign out the other devices only (after a password reset). */
  signOut(o?: { scope?: 'local' | 'others' }): Promise<void>;
  /** The access token for the API, refreshed when needed; null when signed out. */
  accessToken(): Promise<string | null>;
  /** The link of an invitation or a reset email (the Welcome and Reset screens). */
  verifyLink(tokenHash: string, type: LinkType): Promise<void>;
  setPassword(password: string): Promise<void>;
}

export function alwaysSignedIn(): AuthPort {
  return {
    status: () => 'signed_in',
    subscribe: () => () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
    accessToken: async () => null,
    verifyLink: async () => undefined,
    setPassword: async () => undefined,
  };
}
