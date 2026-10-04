import type { FakeAuthAdmin } from '../test/fakes/authAdmin';
import { fakeAuthAdmin } from '../test/fakes/authAdmin';
import { AuthAdminError, type AuthAdmin, type AuthUserInfo, type UpdateEmailOptions } from './admin';

/**
 * For tests only: the T0 fake of Supabase Auth with the parts of the real Auth that track P relies on (proof.md, section P1).
 * - accept(authUserId): the person used the link and set a password, so the email is confirmed.
 * - An "invite" link for a person who accepted is refused with 422 email_exists, as the real Auth does.
 * - listUsers, getUser and updateEmail { confirm }, which the merge lead patch of P2 adds to AuthAdminPort and to the T0 fake.
 * - failNext(error): the next Auth call fails once.
 */
export type FakeAuth = FakeAuthAdmin & AuthAdmin & {
  confirmed: Set<string>;
  accept(authUserId: string): void;
  failNext(error: Error): void;
};

export function fakeAuth(base: FakeAuthAdmin = fakeAuthAdmin()): FakeAuth {
  const confirmed = new Set<string>();
  let failure: Error | null = null;
  const check = () => {
    if (failure) {
      const error = failure;
      failure = null;
      throw error;
    }
  };
  const info = (id: string): AuthUserInfo | null => {
    const user = base.users.get(id);
    return user ? { authUserId: id, email: user.email, confirmed: confirmed.has(id) } : null;
  };
  return {
    ...base,
    users: base.users,
    links: base.links,
    confirmed,
    accept(authUserId) {
      confirmed.add(authUserId);
    },
    failNext(error) {
      failure = error;
    },
    async generateLink(type, email) {
      check();
      const existing = [...base.users.entries()].find(([, user]) => user.email === email.toLowerCase())?.[0];
      if (type === 'invite' && existing && confirmed.has(existing)) {
        throw new AuthAdminError(422, 'email_exists', 'A user with this email address has already been registered');
      }
      return base.generateLink(type, email);
    },
    async createUser(email, password) {
      check();
      const made = await base.createUser(email, password);
      confirmed.add(made.authUserId);
      return made;
    },
    async setBanned(authUserId, banned) {
      check();
      return base.setBanned(authUserId, banned);
    },
    async updateEmail(authUserId: string, email: string, o: UpdateEmailOptions = {}) {
      check();
      await base.updateEmail(authUserId, email);
      // As the real Auth: email_confirm confirms the person; the email alone leaves the confirm state as it was.
      if (o.confirm === true) confirmed.add(authUserId);
    },
    async listUsers() {
      check();
      return [...base.users.keys()].map((id) => info(id)!);
    },
    async getUser(authUserId) {
      check();
      return info(authUserId);
    },
  };
}
