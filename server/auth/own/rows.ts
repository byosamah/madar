/**
 * The SQL texts of the sign-in rows (Supabase exit, wave 2; schema version 2). SQLite only: ?n values, ISO time text, 1 and 0
 * for a flag, and no outer order by. Every time value comes from deps.clock.
 */

export type AuthUserRow = {
  id: string; user_id: string | null; email: string; password_hash: string | null;
  password_set: number; email_confirmed: number; banned: number;
};
const AUTH_USER_COLUMNS = 'id, user_id, email, password_hash, password_set, email_confirmed, banned';
export const AUTH_USER_BY_EMAIL = `select ${AUTH_USER_COLUMNS} from auth_users where email = ?1`;
export const AUTH_USER_BY_ID = `select ${AUTH_USER_COLUMNS} from auth_users where id = ?1`;
export const AUTH_USER_LIST = 'select id, email, email_confirmed, password_set from auth_users';
/** ?1 id, ?2 email, ?3 hash or null, ?4 password_set, ?5 email_confirmed, ?6 now. */
export const AUTH_USER_INSERT = 'insert into auth_users (id, email, password_hash, password_set, email_confirmed, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?6)';
export const AUTH_USER_BAN = 'update auth_users set banned = ?2, updated_at = ?3 where id = ?1';
/** ?3 is 1 to confirm the new email; 0 keeps the confirm state as it is (Supabase updateEmail without email_confirm). */
export const AUTH_USER_EMAIL = 'update auth_users set email = ?2, email_confirmed = max(email_confirmed, ?3), updated_at = ?4 where id = ?1';
export const AUTH_USER_CONFIRM = 'update auth_users set email_confirmed = 1, updated_at = ?2 where id = ?1 and email_confirmed = 0';
/** A saved password: the hash, the mark of users.invites (PASSWORD_SET_MARK), and a confirmed email. */
export const AUTH_USER_PASSWORD = 'update auth_users set password_hash = ?2, password_set = 1, email_confirmed = 1, updated_at = ?3 where id = ?1';
/** A sign-in with a password proves it is set; ?2 a new hash (an upgrade) or null. */
export const AUTH_USER_SIGNED_IN = 'update auth_users set password_set = 1, password_hash = coalesce(?2, password_hash), updated_at = ?3 where id = ?1';

export type LinkRow = { token_hash: string; auth_id: string; type: 'invite' | 'recovery'; expires_at: string; used_at: string | null };
export const LINK_INSERT = 'insert into auth_links (token_hash, auth_id, type, expires_at, created_at) values (?1, ?2, ?3, ?4, ?5)';
export const LINK_BY_HASH = 'select token_hash, auth_id, type, expires_at, used_at from auth_links where token_hash = ?1';
/** One use, and the newest link only: this ends every open link of the person. */
export const LINKS_END = 'update auth_links set used_at = ?2 where auth_id = ?1 and used_at is null';

export type Amr = 'password' | 'link' | 'oauth';
export type SessionRow = {
  id: string; auth_id: string; client_id: string | null; amr: Amr; refresh_hash: string; prev_hash: string | null;
  rotated_at: string | null; link_until: string | null; expires_at: string; revoked_at: string | null;
};
const SESSION_COLUMNS = 'id, auth_id, client_id, amr, refresh_hash, prev_hash, rotated_at, link_until, expires_at, revoked_at';
/** ?1 id, ?2 auth id, ?3 client id or null, ?4 amr, ?5 refresh hash, ?6 link_until or null, ?7 expires_at, ?8 now. */
export const SESSION_INSERT = 'insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, link_until, expires_at, last_used_at, created_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)';
export const SESSION_BY_ID = `select ${SESSION_COLUMNS} from auth_sessions where id = ?1`;
export const SESSION_BY_REFRESH = `select ${SESSION_COLUMNS} from auth_sessions where refresh_hash = ?1`;
export const SESSION_BY_PREV = `select ${SESSION_COLUMNS} from auth_sessions where prev_hash = ?1`;
/** ?2 the new refresh hash, ?3 now, ?4 the new end. The old hash stays as prev_hash for the reuse window. */
export const SESSION_ROTATE = 'update auth_sessions set prev_hash = refresh_hash, refresh_hash = ?2, rotated_at = ?3, last_used_at = ?3, expires_at = ?4 where id = ?1';
export const SESSION_END = 'update auth_sessions set revoked_at = ?2 where id = ?1 and revoked_at is null';
export const SESSIONS_END_ALL = 'update auth_sessions set revoked_at = ?2 where auth_id = ?1 and revoked_at is null';
export const SESSIONS_END_OTHERS = 'update auth_sessions set revoked_at = ?3 where auth_id = ?1 and id <> ?2 and revoked_at is null';
/** A link session may set a password once: after the save it is a plain session. */
export const SESSION_LINK_DONE = 'update auth_sessions set link_until = null where id = ?1';
/** The sign-out of one device: only a session of the same person ends. */
export const SESSION_END_OWN = 'update auth_sessions set revoked_at = ?3 where id = ?1 and auth_id = ?2 and revoked_at is null';
/** Whether the agent link of a client is removed (a refresh of an agent session needs a live link). */
export const AGENT_LINK_STATE = 'select revoked_at from agent_links where client_id = ?1';
