import type { AuthPort, AuthStatus, LinkType } from '../../app/auth';
import { AuthFailure, MIN_PASSWORD } from './authFailure';
import { clearLeaving, leftOnPurpose, markLeaving, type SessionChange, type SessionListener } from './sessionEnd';

export type FakeAccount = { email: string; password: string; userId: string; off?: boolean };
export type FakeLink = { type: LinkType; email: string; used?: boolean };

/** What the fake did, in order, so a test can check the steps of a screen. */
export type FakeAuth = AuthPort & {
  readonly log: string[];
  readonly resets: string[];
  current(): FakeAccount | null;
  /** The session ends without a sign-out, as when the refresh token is gone. */
  expire(): void;
  /** Another tab of the browser signs out on purpose: Supabase tells this tab, which did not sign out itself. */
  otherTabSignsOut(): void;
  /** Another tab of the browser signs in as this person. */
  otherTabSignsIn(email: string): void;
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
  const listeners = new Set<SessionListener>();
  const log: string[] = [];
  const resets: string[] = [];
  let current: FakeAccount | null = o.signedInAs ? accounts.get(o.signedInAs.toLowerCase()) ?? null : null;

  // As the Supabase port: the person of the last session stays after a sign-out, and a sign-in of someone else is a change.
  let lastUserId: string | null = current?.userId ?? null;

  const status = (): AuthStatus => (current ? 'signed_in' : 'signed_out');
  const become = (next: FakeAccount | null) => {
    const before = status();
    const otherPerson = next !== null && lastUserId !== null && next.userId !== lastUserId;
    current = next;
    if (next) {
      lastUserId = next.userId;
      o.onSignIn?.(next);
    }
    let change: SessionChange | undefined;
    if (otherPerson) change = 'person';
    else if (status() === 'signed_out' && leftOnPurpose()) change = 'left';
    if (otherPerson || status() !== before) for (const listener of [...listeners]) listener(status(), change);
  };

  return {
    log,
    resets,
    current: () => current,
    expire: () => {
      log.push('expire');
      become(null);
    },
    otherTabSignsOut: () => {
      markLeaving();
      become(null);
    },
    otherTabSignsIn: (email) => {
      clearLeaving();
      become(accounts.get(email.toLowerCase()) ?? null);
    },
    status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      log.push(`signIn:${email}`);
      clearLeaving();
      const account = accounts.get(email.trim().toLowerCase());
      if (!account || account.password !== password) throw new AuthFailure('wrong_credentials');
      if (account.off) throw new AuthFailure('account_off');
      become(account);
    },
    async signOut(options) {
      const scope = options?.scope ?? 'local';
      log.push(`signOut:${scope}`);
      if (scope === 'local') {
        markLeaving();
        become(null);
      }
    },
    async accessToken() {
      return current ? `token-${current.userId}` : null;
    },
    async verifyLink(tokenHash, type) {
      log.push(`verifyLink:${type}`);
      clearLeaving();
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
