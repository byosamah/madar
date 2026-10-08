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
  /** The auth user id of the session at once, with no network; null when signed out. The prototype has none. */
  userId?(): string | null;
  /** The link of an invitation or a reset email (the Welcome and Reset screens). */
  verifyLink(tokenHash: string, type: LinkType): Promise<void>;
  /** Sets a password from the session of an invitation or reset link (the Welcome and Reset screens). */
  setPassword(password: string): Promise<void>;
  /**
   * Changes the password of the signed-in person (Settings, Password). The port checks the current password with a sign-in,
   * whether or not Auth has "require current password" on, and sends it with the new one (proof.md Z0a, item 2). A wrong
   * current password fails with the reason wrong_credentials.
   */
  changePassword(current: string, next: string): Promise<void>;
  /**
   * Asks for a password reset link (the Forgot screen). The Supabase version sends a POST with { email } to
   * `${VITE_API_URL}/auth/forgot?forceFunctionRegion=eu-central-1`. It gives the same answer for every address and never throws for an unknown one.
   */
  requestReset(email: string): Promise<void>;
  /**
   * Asks for a new invitation link (the Welcome screen, when the link is out of date; security fix 7). It sends only the renew
   * key of the invitation link: a POST with { key } to `${VITE_API_URL}/auth/renew-invite?forceFunctionRegion=eu-central-1`.
   * The server sends the new link to the address it holds, and gives the same answer for every key.
   */
  renewInvite(key: string): Promise<void>;
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
    changePassword: async () => undefined,
    requestReset: async () => undefined,
    renewInvite: async () => undefined,
  };
}
