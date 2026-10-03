import type { AuthAdminPort } from '../../core/ports';

type AuthUser = { email: string; password: string | null; banned: boolean };
export type FakeAuthAdmin = AuthAdminPort & {
  users: Map<string, AuthUser>;
  links: { type: 'invite' | 'recovery'; email: string; authUserId: string; tokenHash: string }[];
};

/** Supabase Auth in memory: a link makes the user when the email is new, as generate_link does. */
export function fakeAuthAdmin(): FakeAuthAdmin {
  const users = new Map<string, AuthUser>();
  const links: FakeAuthAdmin['links'] = [];
  let n = 0;
  const byEmail = (email: string) => [...users.entries()].find(([, user]) => user.email === email.toLowerCase())?.[0];
  const make = (email: string, password: string | null) => {
    n += 1;
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    users.set(id, { email: email.toLowerCase(), password, banned: false });
    return id;
  };
  const existing = (id: string) => {
    const user = users.get(id);
    if (!user) throw new Error(`No Auth user ${id}.`);
    return user;
  };
  return {
    users,
    links,
    async generateLink(type, email) {
      const authUserId = byEmail(email) ?? make(email, null);
      const tokenHash = `hash_${links.length + 1}`;
      links.push({ type, email, authUserId, tokenHash });
      return { authUserId, tokenHash };
    },
    async createUser(email, password) {
      if (byEmail(email)) throw new Error('This email is already in use.');
      return { authUserId: make(email, password) };
    },
    async setBanned(authUserId, banned) {
      existing(authUserId).banned = banned;
    },
    async updateEmail(authUserId, email) {
      existing(authUserId).email = email.toLowerCase();
    },
  };
}
