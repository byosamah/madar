import { AwsClient } from 'aws4fetch';
import { FILE_STORE_LIMITS, type FilesPort } from '../core/ports';
import { assertObjectKey } from './keys';
import { DOWNLOAD_LINK_SECONDS, HEAD_TIMEOUT_MS, UPLOAD_LINK_SECONDS, baseMimeType, contentDisposition, effectiveDisposition, storedMimeType, withTimeout } from './links';

export type R2Env = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Another S3 endpoint instead of the R2 EU endpoint. Only the tests set it (MinIO, server/it/minio.ts). */
  endpoint?: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

/** How many deletes run at once in remove. R2 takes a DeleteObjects body only with Content-MD5, so each key goes alone. */
const DELETE_AT_ONCE = 8;

/** 20261004T093000Z, the AWS form of a time. */
function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** The S3 endpoint of the bucket: the R2 EU endpoint of the account, or the endpoint that the env names. */
export function r2Endpoint(env: Pick<R2Env, 'accountId' | 'endpoint'>): string {
  return (env.endpoint ?? `https://${env.accountId}.eu.r2.cloudflarestorage.com`).replace(/\/+$/, '');
}

/**
 * The R2 store with aws4fetch on the EU endpoint (plan 5.2), ready for the switch MADAR_FILE_STORE=r2.
 * Signed links live 10 minutes. An upload link signs only Content-Type beside the host, so the browser sends one header that
 * the CORS rule allows, and a PUT with another type fails. The signed type is storedMimeType: application/octet-stream for
 * every download-only type. A download link carries response-content-disposition in the RFC 6266 form; every type outside
 * the inline safe list is always attachment.
 */
export function r2FilesPort(env: R2Env): FilesPort {
  const endpoint = r2Endpoint(env);
  const now = env.now ?? (() => new Date());
  const fetchImpl = env.fetch ?? ((input, init) => fetch(input, init));
  const client = new AwsClient({ accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey, service: 's3', region: 'auto', retries: 0 });
  const urlOf = (key: string) => {
    assertObjectKey(key);
    return `${endpoint}/${env.bucket}/${key}`;
  };

  /** A signed request, sent with the fetch of the env, so the tests can watch it. */
  async function send(what: string, method: string, key: string, o: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<Response> {
    const request = await client.sign(urlOf(key), { method, headers: o.headers ?? {}, aws: { datetime: amzDate(now()) } });
    let response: Response;
    try {
      response = await fetchImpl(request, o.signal ? { signal: o.signal } : undefined);
    } catch (error) {
      if (o.signal?.aborted) throw o.signal.reason;
      throw new Error(`R2 ${what} failed: ${error instanceof Error ? error.message : 'network error'}.`);
    }
    return response;
  }

  /** The error of a failed step: the step, the status and the S3 code, never a key or a link. */
  function failed(what: string, status: number, body: string): Error {
    const code = /<Code>([^<]{1,80})<\/Code>/.exec(body)?.[1];
    return new Error(`R2 ${what} failed with ${status}${code ? ` (${code})` : ''}.`);
  }

  async function failure(what: string, response: Response): Promise<Error> {
    return failed(what, response.status, await response.text().catch(() => ''));
  }

  async function presign(method: 'PUT' | 'GET', key: string, seconds: number, o: { headers?: Record<string, string>; query?: Record<string, string> }) {
    const at = now();
    const url = new URL(urlOf(key));
    for (const [name, value] of Object.entries(o.query ?? {})) url.searchParams.set(name, value);
    url.searchParams.set('X-Amz-Expires', String(seconds));
    // allHeaders: aws4fetch leaves Content-Type unsigned by default, and the upload must sign it.
    const signed = await client.sign(url.toString(), { method, headers: o.headers ?? {}, aws: { signQuery: true, allHeaders: true, datetime: amzDate(at) } });
    return { url: signed.url, expiresAt: new Date(at.getTime() + seconds * 1000).toISOString() };
  }

  return {
    kind: 'r2',
    maxFileBytes: FILE_STORE_LIMITS.r2.maxFileBytes,

    async presignPut(key, o) {
      const type = storedMimeType(o.mimeType);
      const { url, expiresAt } = await presign('PUT', key, UPLOAD_LINK_SECONDS.r2, { headers: { 'content-type': type } });
      return { url, headers: { 'Content-Type': type }, expiresAt };
    },

    async presignGet(key, o) {
      const disposition = contentDisposition(effectiveDisposition(o.disposition, o.mimeType), o.filename);
      return presign('GET', key, DOWNLOAD_LINK_SECONDS, { query: { 'response-content-disposition': disposition } });
    },

    async head(key, o) {
      const timeoutMs = o?.timeoutMs ?? HEAD_TIMEOUT_MS;
      return withTimeout(`R2 head of ${key}`, timeoutMs, async (signal) => {
        const response = await send('head', 'HEAD', key, { signal });
        if (response.status === 404) return null;
        if (!response.ok) throw await failure('head', response);
        return { size: Number(response.headers.get('content-length') ?? 0), mimeType: baseMimeType(response.headers.get('content-type') ?? '') };
      });
    },

    async copy(from, to) {
      assertObjectKey(from);
      const response = await send('copy', 'PUT', to, { headers: { 'x-amz-copy-source': `/${env.bucket}/${from}` } });
      const body = await response.text();
      // S3 can answer a copy with 200 and an error body.
      if (!response.ok || /<Error>/.test(body)) throw failed('copy', response.status, body);
    },

    async remove(keys) {
      for (const key of keys) assertObjectKey(key);
      for (let i = 0; i < keys.length; i += DELETE_AT_ONCE) {
        await Promise.all(
          keys.slice(i, i + DELETE_AT_ONCE).map(async (key) => {
            const response = await send('remove', 'DELETE', key);
            if (!response.ok && response.status !== 404) throw await failure('remove', response);
            await response.body?.cancel();
          }),
        );
      }
    },
  };
}
