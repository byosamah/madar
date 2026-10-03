// Pure helpers for the Z0a cloud probes (plan, section 6.3, track Z). No network here.
// Every probe builds its connections through these helpers, so no probe can reach the production project.

/** madar-test: the only project that a probe may change. */
export const TEST_REF = 'qdgwpnesxppnqsaabqzd';
/** madar: production. Probes refuse it. */
export const PRODUCTION_REF = 'oprkvdjudjxxhvodkzgs';
/** The shared pooler of both projects (accounts.md). */
export const POOLER_HOST = 'aws-1-eu-central-1.pooler.supabase.com';

export function assertTestRef(ref: string): string {
  if (ref !== TEST_REF) throw new Error(`probes run only on madar-test (${TEST_REF}), not on "${ref}"`);
  return ref;
}

export type PoolerConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: false | { ca: string; rejectUnauthorized: true; servername: string };
};

/** A pg connection through the hosted pooler: session mode on 5432, transaction mode on 6543. The user is `<role>.<ref>`. */
export function poolerConfig(opts: {
  ref: string;
  role: string;
  password: string;
  mode: 'session' | 'transaction';
  ca: string | false;
}): PoolerConfig {
  assertTestRef(opts.ref);
  return {
    host: POOLER_HOST,
    port: opts.mode === 'transaction' ? 6543 : 5432,
    user: `${opts.role}.${opts.ref}`,
    password: opts.password,
    database: 'postgres',
    ssl: opts.ca === false ? false : { ca: opts.ca, rejectUnauthorized: true, servername: POOLER_HOST },
  };
}

/** The claims of a JWT. It does not check the signature: the probes only read what Auth issued. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('not a token: a JWT has three parts');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

export type Disposition = { type: string; filename?: string; filenameStar?: string };

/** Reads a Content-Disposition header: the type, the plain `filename` and the RFC 5987 `filename*` (UTF-8 only). */
export function parseContentDisposition(value: string | null): Disposition {
  if (!value) return { type: '' };
  const [type, ...params] = value.split(';').map((part) => part.trim());
  const out: Disposition = { type: type.toLowerCase() };
  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq < 0) continue;
    const name = param.slice(0, eq).trim().toLowerCase();
    let raw = param.slice(eq + 1).trim();
    if (name === 'filename') {
      if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
      out.filename = raw;
    } else if (name === 'filename*') {
      const match = /^UTF-8''(.*)$/i.exec(raw);
      if (match) out.filenameStar = decodeURIComponent(match[1]);
    }
  }
  return out;
}

/** The S256 code challenge of a PKCE verifier (RFC 7636). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString('base64url');
}

/** A random PKCE verifier or password: 32 random bytes in base64url. */
export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

/** Replaces each secret in a text with `[secret]`, so no probe output holds one. Empty values are skipped. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join('[secret]');
  return out;
}
