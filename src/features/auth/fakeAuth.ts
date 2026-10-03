import type { AuthPort, AuthStatus, LinkType } from '../../app/auth';
import { AuthFailure, MIN_PASSWORD } from './authFailure';

export type FakeAccount = { email: string; password: string; userId: string; off?: boolean };
export type FakeLink = { type: LinkType; email: string; used?: boolean };

/** What the fake did, in order, so a test can check the steps of a screen. */
export type FakeAuth = AuthPort & {
  readonly log: string[];
  readonly resets: string[];
  current(): FakeAccount | null;
  /** The session ends without a sign-out, as when the refresh token is gone. */
  expire(): void;
};

/**
 * A sign-in port for the screen tests, with no network. Each account maps to a person of the office, and `onSignIn` lets a test
 * make that person the current one, as the server does when it reads the person from the token.
 */
export function fakeAuth(o: {
  accounts: FakeAccount[];
  signedInAs?: string;
  links?: Record<string, FakeLink>;
  onSignIn?: (account: FakeAccount) => void;
}): FakeAuth {
  const accounts = new Map(o.accounts.map((account) => [account.email.toLowerCase(), { ...account }]));
  const links = new Map(Object.entries(o.links ?? {}));
  const listeners = new Set<(status: AuthStatus) => void>();
  const log: string[] = [];
  const resets: string[] = [];
  let current: FakeAccount | null = o.signedInAs ? accounts.get(o.signedInAs.toLowerCase()) ?? null : null;

  const status = (): AuthStatus => (current ? 'signed_in' : 'signed_out');
  const become = (next: FakeAccount | null) => {
    const before = status();
    current = next;
    if (next) o.onSignIn?.(next);
    if (status() !== before) for (const listener of [...listeners]) listener(status());
  };

  return {
    log,
    resets,
    current: () => current,
    expire: () => {
      log.push('expire');
      become(null);
    },
    status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      log.push(`signIn:${email}`);
      const account = accounts.get(email.trim().toLowerCase());
      if (!account || account.password !== password) throw new AuthFailure('wrong_credentials');
      if (account.off) throw new AuthFailure('account_off');
      become(account);
    },
    async signOut(options) {
      const scope = options?.scope ?? 'local';
      log.push(`signOut:${scope}`);
      if (scope === 'local') become(null);
    },
    async accessToken() {
      return current ? `token-${current.userId}` : null;
    },
    async verifyLink(tokenHash, type) {
      log.push(`verifyLink:${type}`);
      const link = links.get(tokenHash);
      if (!link || link.used || link.type !== type) throw new AuthFailure('link_ended');
      link.used = true;
      become(accounts.get(link.email.toLowerCase()) ?? null);
    },
    async setPassword(password) {
      log.push('setPassword');
      if (!current) throw new AuthFailure('failed');
      if (password.length < MIN_PASSWORD) throw new AuthFailure('short');
      if (password === current.password) throw new AuthFailure('same');
      current.password = password;
    },
    async requestReset(email) {
      log.push('requestReset');
      resets.push(email);
    },
  };
}
