/** The SQL texts of the OAuth rows (Supabase exit, wave 2; schema version 2). SQLite only. */
export type ClientRow = { id: string; name: string | null; redirect_uris: string };
export const CLIENT_INSERT = 'insert into oauth_clients (id, name, redirect_uris, created_at) values (?1, ?2, ?3, ?4)';
export const CLIENT_BY_ID = 'select id, name, redirect_uris from oauth_clients where id = ?1';

export type RequestRow = {
  id: string; client_id: string; redirect_uri: string; state: string | null; code_challenge: string; auth_id: string | null;
  status: 'pending' | 'approved' | 'denied' | 'used'; code_hash: string | null; code_until: string | null; expires_at: string;
};
const REQUEST_COLUMNS = 'id, client_id, redirect_uri, state, code_challenge, auth_id, status, code_hash, code_until, expires_at';
export const REQUEST_INSERT = 'insert into oauth_requests (id, client_id, redirect_uri, state, code_challenge, scope, resource, expires_at, created_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)';
export const REQUEST_BY_ID = `select ${REQUEST_COLUMNS} from oauth_requests where id = ?1`;
export const REQUEST_BY_CODE = `select ${REQUEST_COLUMNS} from oauth_requests where code_hash = ?1`;
/** The first person who opens a request owns it; a request of another person reads as ended. */
export const REQUEST_BIND = 'update oauth_requests set auth_id = ?2 where id = ?1 and auth_id is null';
export const REQUEST_APPROVE = "update oauth_requests set status = 'approved', code_hash = ?2, code_until = ?3 where id = ?1 and status = 'pending'";
export const REQUEST_DENY = "update oauth_requests set status = 'denied' where id = ?1 and status = 'pending'";
export const REQUEST_USED = "update oauth_requests set status = 'used' where id = ?1 and status = 'approved'";
/** The AI apps with a live agent session of the person (Settings, Agents), and the end of one of them. */
export const GRANTS_LITE =
  'select s.client_id as client_id, c.name as client_name, min(s.created_at) as granted_at from auth_sessions s join oauth_clients c on c.id = s.client_id ' +
  'where s.auth_id = ?1 and s.client_id is not null and s.revoked_at is null and s.expires_at > ?2 group by s.client_id, c.name';
export const GRANT_REVOKE = 'update auth_sessions set revoked_at = ?3 where auth_id = ?1 and client_id = ?2 and revoked_at is null';
