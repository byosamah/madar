/**
 * The names and rules of Madar enterprises (design 5.1 and 5.2). This file has no import, so every part of the server loads it,
 * the Postgres path included.
 */

export type EnterpriseId = string; // form ^ent_\d{3,}$
export const ENTERPRISE_ID = /^ent_\d{3,}$/;
/** VADOs' Companies, the office of today. */
export const ENT_VADO: EnterpriseId = 'ent_001';
export const ADDRESS_NAME = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
export const VADO_ADDRESS = 'vados';
/** The name of the one platform object. */
export const PLATFORM_OBJECT = 'platform';

/**
 * Words that an address name may not take. oauth is a path word of the OAuth routes (/mcp/oauth/token is never an address), and
 * oauth-protected-resource is the path of the resource metadata (/mcp/oauth-protected-resource).
 */
export const RESERVED_ADDRESSES: readonly string[] = ['oauth', 'oauth-protected-resource', 'mcp', 'api', 'platform', 'admin', 'www'];

/** The secret of a tag: base64url text of a link, a renew key or a socket ticket. */
const TAG_SECRET = /^[A-Za-z0-9_-]{1,300}$/;
/** The longest tagged text that untag reads: "ent_" + digits, a dot, and the secret. */
const TAG_MAX = 320;

export function isEnterpriseId(value: unknown): value is EnterpriseId {
  return typeof value === 'string' && ENTERPRISE_ID.test(value);
}

export function isAddressName(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS_NAME.test(value) && !RESERVED_ADDRESSES.includes(value);
}

/** The rule of the users records: trim, then lower case. The directory and the sign-in use this one rule. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** "<ent>.<secret>": the tag of a link, a renew key or a socket ticket. */
export function tagged(ent: EnterpriseId, secret: string): string {
  return `${ent}.${secret}`;
}

/** The parts of a tagged text, or null for any other form. An untagged text is null: there is no fallback to an enterprise. */
export function untag(text: string): { ent: EnterpriseId; secret: string } | null {
  if (typeof text !== 'string' || text.length > TAG_MAX) return null;
  const dot = text.indexOf('.');
  if (dot < 0) return null;
  const ent = text.slice(0, dot);
  const secret = text.slice(dot + 1);
  if (!isEnterpriseId(ent) || !TAG_SECRET.test(secret)) return null;
  return { ent, secret };
}
