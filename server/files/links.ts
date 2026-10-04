import type { FileStoreKind } from '../core/ports';

/**
 * The rules that both stores share for signed links (plan 5.2; proof.md, Z0a item 6).
 */

/**
 * The life of an upload link. Storage gives 2 hours and takes no shorter life (proof.md, Z0a item 6); R2 signs 10 minutes.
 * Storage also keeps a 2-hour link working after the file arrived, so files.upload must never trust the link life alone.
 */
export const UPLOAD_LINK_SECONDS: Record<FileStoreKind, number> = { supabase: 7200, r2: 600 };

/** The life of a download link on both stores. */
export const DOWNLOAD_LINK_SECONDS = 600;

/** The extra time for the transfer: R2 checks only that the signed PUT starts in time, Storage checks the whole PUT. */
const UPLOAD_TRANSFER_SECONDS: Record<FileStoreKind, number> = { supabase: 0, r2: 3600 };

/** The life of an upload_intents row (expires_at): the link life plus the transfer time of the store. */
export function intentLifeSeconds(kind: FileStoreKind): number {
  return UPLOAD_LINK_SECONDS[kind] + UPLOAD_TRANSFER_SECONDS[kind];
}

/** A type in lower case without its parameters: "TEXT/HTML; charset=utf-8" becomes "text/html". Every type check uses this form. */
export function baseMimeType(type: string): string {
  return type.split(';')[0].trim().toLowerCase();
}

const DOWNLOAD_ONLY = new Set(['text/html', 'image/svg+xml', 'application/xhtml+xml']);

/** HTML, SVG, XHTML and every XML type: a link to one of these is always a download, so an uploaded page never runs a script. */
export function downloadOnly(type: string): boolean {
  const base = baseMimeType(type);
  return DOWNLOAD_ONLY.has(base) || base.endsWith('/xml') || base.endsWith('+xml');
}

export function effectiveDisposition(disposition: 'inline' | 'attachment', type: string): 'inline' | 'attachment' {
  return downloadOnly(type) ? 'attachment' : disposition;
}

const NAME_LIMIT = 200;

/** The last part of a name, with no control characters and at most 200 characters (the extension stays). Never empty. */
export function safeFileName(name: string): string {
  const clean = (name.split(/[/\\]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (clean === '' || clean === '.' || clean === '..') return 'file';
  const chars = [...clean];
  if (chars.length <= NAME_LIMIT) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 ? [...clean.slice(dot)] : [];
  if (ext.length > 0 && ext.length < 20) return chars.slice(0, NAME_LIMIT - ext.length).join('') + ext.join('');
  return chars.slice(0, NAME_LIMIT).join('');
}

/** RFC 5987 attr-char: everything else is percent-encoded. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The Content-Disposition of a download (RFC 6266 with RFC 5987): an ASCII fallback for old clients, then the UTF-8 name.
 * attachment; filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded name>
 */
export function contentDisposition(disposition: 'inline' | 'attachment', name: string): string {
  const safe = safeFileName(name);
  const fallback = safe.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${rfc5987(safe)}`;
}

/** Waits for a store call, and fails with a plain message after the time limit. */
export async function withTimeout<T>(what: string, timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${what} did not answer in ${timeoutMs} ms.`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The time limit of head in the preflight (plan 5.2, step 3). */
export const HEAD_TIMEOUT_MS = 3000;
