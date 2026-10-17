import type { Clock, Db } from '../../core/ports';
import { AuthAdminError, type AuthAdmin, type AuthUserInfo, type UpdateEmailOptions } from '../admin';
import { randomToken, sha256Hex } from './crypto';
import { hashPassword } from './password';
import {
  AUTH_USER_BAN, AUTH_USER_BY_EMAIL, AUTH_USER_BY_ID, AUTH_USER_EMAIL, AUTH_USER_INSERT, AUTH_USER_LIST, LINK_INSERT, LINKS_END,
  SESSIONS_END_ALL, type AuthUserRow,
} from './rows';

/**
 * The Auth admin port over the sign-in rows of the office object (Supabase exit, wave 2). It keeps the rules of Supabase Auth that
 * the effects rely on (proof.md P1): an invite link for a confirmed email answers 422 email_exists, a new link ends the older open
 * links of the person, and the admin calls send no mail. The links are random (32 bytes), live 1 hour and work once; the table
 * keeps only the sha256 of a token (this closes security fix 8: no token comes from an email and a 6-digit code any more).
 * Each method runs its crypto before its transaction, never inside one.
 *
 * The port field tokenHash holds the link token itself: the mail carries it as token_hash, and the table keeps only its sha256.
 */

export const LINK_LIFE_MS = 60 * 60 * 1000;

const info = (row: Pick<AuthUserRow, 'id' | 'email' | 'email_confirmed' | 'password_set'>): AuthUserInfo => ({
  authUserId: row.id, email: row.email, confirmed: row.email_confirmed === 1, passwordSet: row.password_set === 1,
});

const emailExists = () => new AuthAdminError(422, 'email_exists', 'A user with this email address has already been registered.');

function isUniqueError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE');
}

export function liteAuthAdmin(o: { db: Db; clock: Clock }): AuthAdmin {
  return {
    async generateLink(type, email) {
      const address = email.trim().toLowerCase();
      const token = randomToken();
      const hash = await sha256Hex(token);
      const now = o.clock.now();
      return o.db.tx('write', async (q) => {
        const [found] = await q<AuthUserRow>(AUTH_USER_BY_EMAIL, [address]);
        if (found && type === 'invite' && found.email_confirmed === 1) throw emailExists();
        if (!found && type === 'recovery') throw new AuthAdminError(404, 'user_not_found', 'No sign-in row has this email.');
        const authId = found?.id ?? crypto.randomUUID();
        if (!found) await q(AUTH_USER_INSERT, [authId, address, null, 0, 0, now.toISOString()]);
        await q(LINKS_END, [authId, now.toISOString()]);
        await q(LINK_INSERT, [hash, authId, type, new Date(now.getTime() + LINK_LIFE_MS).toISOString(), now.toISOString()]);
        return { authUserId: authId, tokenHash: token };
      });
    },
    async createUser(email, password) {
      const address = email.trim().toLowerCase();
      const hash = await hashPassword(password);
      const authId = crypto.randomUUID();
      await o.db.tx('write', async (q) => {
        if ((await q(AUTH_USER_BY_EMAIL, [address])).length > 0) throw emailExists();
        await q(AUTH_USER_INSERT, [authId, address, hash, 1, 1, o.clock.now().toISOString()]);
      });
      return { authUserId: authId };
    },
    async setBanned(authUserId, banned) {
      const now = o.clock.now().toISOString();
      await o.db.tx('write', async (q) => {
        await q(AUTH_USER_BAN, [authUserId, banned ? 1 : 0, now]);
        // A ban ends every session, browser and agent, so no refresh works after it. An access token lives 15 minutes at most.
        if (banned) await q(SESSIONS_END_ALL, [authUserId, now]);
      });
    },
    async updateEmail(authUserId: string, email: string, u: UpdateEmailOptions = {}) {
      try {
        await o.db.statement('write', AUTH_USER_EMAIL, [authUserId, email.trim().toLowerCase(), u.confirm === true ? 1 : 0, o.clock.now().toISOString()]);
      } catch (error) {
        if (isUniqueError(error)) throw emailExists();
        throw error;
      }
    },
    async listUsers() {
      return (await o.db.statement<AuthUserRow>('read', AUTH_USER_LIST)).map(info);
    },
    async getUser(authUserId) {
      const [row] = await o.db.statement<AuthUserRow>('read', AUTH_USER_BY_ID, [authUserId]);
      return row ? info(row) : null;
    },
  };
}
