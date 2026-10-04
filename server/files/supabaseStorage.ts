import { FILE_STORE_LIMITS, type FilesPort } from '../core/ports';
import { assertObjectKey } from './keys';
import { DOWNLOAD_LINK_SECONDS, HEAD_TIMEOUT_MS, UPLOAD_LINK_SECONDS, baseMimeType, effectiveDisposition, safeFileName, storedMimeType, withTimeout } from './links';

export type SupabaseStorageEnv = {
  supabaseUrl: string;
  secretKey: string;
  bucket: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

/** Storage removes at most 1000 objects in one call. */
const REMOVE_AT_ONCE = 1000;

/** The exp claim of a signed link token, or null when the token does not read as a JWT. The signature is Storage's to check. */
function tokenExpiry(link: string): Date | null {
  try {
    const token = new URL(link, 'http://x').searchParams.get('token');
    const payload = token?.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as { exp?: unknown };
    return typeof claims.exp === 'number' ? new Date(claims.exp * 1000) : null;
  } catch {
    return null;
  }
}

/**
 * The default store (plan 2b, point 1): the private bucket madar-files on Supabase Storage, through the raw Storage API with
 * the secret key, the same on Edge Functions and on Workers.
 *
 * - Upload links (object/upload/sign) live 2 hours: Storage takes no shorter life, and expiresAt reports the real one
 *   (proof.md, Z0a item 6). They are signed WITHOUT upsert, never x-upsert: true, so nobody can replace a staging object
 *   between the check and the copy. The upload asks for storedMimeType: application/octet-stream for every download-only type.
 * - Download links (object/sign) live 10 minutes. An attachment adds download=<file name>. download= is a convenience, not a
 *   guard: the token does not cover it, so anyone with a link can remove it. The guard is the stored type, because Storage
 *   serves files from the project origin (the origin of /auth/v1 and /functions/v1/mcp).
 * - head reads object/info; the type comes back in lower case without parameters.
 */
export function supabaseStorageFilesPort(env: SupabaseStorageEnv): FilesPort {
  const storage = `${env.supabaseUrl.replace(/\/+$/, '')}/storage/v1`;
  const now = env.now ?? (() => new Date());
  const fetchImpl = env.fetch ?? ((input, init) => fetch(input, init));
  const auth = { apikey: env.secretKey, authorization: `Bearer ${env.secretKey}` };

  /** The error of a failed step: the step, the status and the Storage code. Never the key, a link or the body text. */
  async function failure(what: string, response: Response): Promise<Error> {
    let code = '';
    try {
      const body = (await response.json()) as { error?: unknown; code?: unknown };
      const value = typeof body.code === 'string' ? body.code : typeof body.error === 'string' ? body.error : '';
      code = /^[A-Za-z_ ]{1,60}$/.test(value) ? ` (${value})` : '';
    } catch {
      // No JSON body.
    }
    return new Error(`Storage ${what} failed with ${response.status}${code}.`);
  }

  async function call(what: string, path: string, init: { method: string; body?: unknown; signal?: AbortSignal }): Promise<Response> {
    const headers: Record<string, string> = { ...auth };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    try {
      return await fetchImpl(`${storage}${path}`, {
        method: init.method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        ...(init.signal ? { signal: init.signal } : {}),
      });
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      throw new Error(`Storage ${what} failed: ${error instanceof Error ? error.message : 'network error'}.`);
    }
  }

  async function json<T>(what: string, path: string, init: { method: string; body?: unknown }): Promise<T> {
    const response = await call(what, path, init);
    if (!response.ok) throw await failure(what, response);
    return (await response.json()) as T;
  }

  /** Storage answers a missing object with 404, or with 400 and statusCode "404" in the body. */
  async function missing(response: Response): Promise<boolean> {
    if (response.status === 404) return true;
    if (response.status !== 400) return false;
    const body = (await response.clone().json().catch(() => ({}))) as { statusCode?: unknown; error?: unknown };
    return String(body.statusCode) === '404' || body.error === 'not_found';
  }

  return {
    kind: 'supabase',
    maxFileBytes: FILE_STORE_LIMITS.supabase.maxFileBytes,

    async presignPut(key, o) {
      assertObjectKey(key);
      const at = now();
      // No x-upsert header and no body: the default is no upsert.
      const signed = await json<{ url: string }>('upload sign', `/object/upload/sign/${env.bucket}/${key}`, { method: 'POST' });
      const expires = tokenExpiry(signed.url) ?? new Date(at.getTime() + UPLOAD_LINK_SECONDS.supabase * 1000);
      return { url: `${storage}${signed.url}`, headers: { 'Content-Type': storedMimeType(o.mimeType) }, expiresAt: expires.toISOString() };
    },

    async presignGet(key, o) {
      assertObjectKey(key);
      const at = now();
      const signed = await json<{ signedURL: string }>('sign', `/object/sign/${env.bucket}/${key}`, { method: 'POST', body: { expiresIn: DOWNLOAD_LINK_SECONDS } });
      let url = `${storage}${signed.signedURL}`;
      if (effectiveDisposition(o.disposition, o.mimeType) === 'attachment') {
        url += `${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(safeFileName(o.filename))}`;
      }
      return { url, expiresAt: new Date(at.getTime() + DOWNLOAD_LINK_SECONDS * 1000).toISOString() };
    },

    async head(key, o) {
      assertObjectKey(key);
      const timeoutMs = o?.timeoutMs ?? HEAD_TIMEOUT_MS;
      return withTimeout(`Storage head of ${key}`, timeoutMs, async (signal) => {
        const response = await call('head', `/object/info/${env.bucket}/${key}`, { method: 'GET', signal });
        if (await missing(response)) return null;
        if (!response.ok) throw await failure('head', response);
        const info = (await response.json()) as { size?: unknown; content_type?: unknown; contentType?: unknown; metadata?: { size?: unknown; mimetype?: unknown } };
        const size = Number(info.size ?? info.metadata?.size ?? 0);
        const type = info.content_type ?? info.contentType ?? info.metadata?.mimetype ?? '';
        return { size, mimeType: baseMimeType(String(type)) };
      });
    },

    async copy(from, to) {
      assertObjectKey(from);
      assertObjectKey(to);
      await json('copy', '/object/copy', { method: 'POST', body: { bucketId: env.bucket, sourceKey: from, destinationKey: to } });
    },

    async remove(keys) {
      for (const key of keys) assertObjectKey(key);
      for (let i = 0; i < keys.length; i += REMOVE_AT_ONCE) {
        await json('remove', `/object/${env.bucket}`, { method: 'DELETE', body: { prefixes: keys.slice(i, i + REMOVE_AT_ONCE) } });
      }
    },
  };
}
