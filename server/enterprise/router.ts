import type { OfficeStub } from '../entries/officeWorker';
import { isAddressName, isEnterpriseId, type EnterpriseId } from './ids';
import type { PlatformStub } from './platform/stub';

/**
 * The one place where the Worker turns an untrusted id into an office object stub (Madar enterprises, design 5.2). A tag of a link, a
 * ticket, an email result or an MCP address gets a stub only after the platform object lists the enterprise, so a wrong or old name
 * never makes a new empty object. An id from a verified token claim goes through stub(): the signature is the proof.
 */

export type EntStub = { ent: EnterpriseId; stub: OfficeStub };

/** How long the Worker keeps the list of enterprises, and how old the list must be before a miss reads it again. */
export const LISTED_TTL_MS = 60_000;
export const LISTED_MISS_MS = 5_000;

/** What an isolate keeps between requests: the list of enterprises and the addresses already resolved. */
export type ListedCache = {
  list?: { at: number; ids: ReadonlySet<EnterpriseId> };
  addresses: Map<string, { at: number; ent: EnterpriseId | null }>;
};

export const newListedCache = (): ListedCache => ({ addresses: new Map() });

export type EntRouter = {
  /** For an ent from a verified token only. */
  stub(ent: EnterpriseId): OfficeStub;
  /** Shape check, then the list of enterprises. null for a malformed id and for an id that is not listed. */
  listedStub(ent: unknown): Promise<EntStub | null>;
  /** isAddressName, then platform.resolveAddress. null for a reserved or malformed name and for an unknown address. */
  addressStub(address: unknown): Promise<EntStub | null>;
};

export function entRouter(o: {
  stubFor: (ent: EnterpriseId) => OfficeStub;
  platform: Pick<PlatformStub, 'listed' | 'resolveAddress'>;
  cache?: ListedCache;
  now?: () => number;
  ttlMs?: number;
  missMs?: number;
}): EntRouter {
  const now = o.now ?? (() => Date.now());
  const ttlMs = o.ttlMs ?? LISTED_TTL_MS;
  const missMs = o.missMs ?? LISTED_MISS_MS;
  const cache = o.cache ?? newListedCache();

  async function readList(): Promise<ReadonlySet<EnterpriseId>> {
    const ids = new Set(await o.platform.listed());
    cache.list = { at: now(), ids };
    return ids;
  }

  async function isListed(ent: EnterpriseId): Promise<boolean> {
    const held = cache.list;
    if (!held || now() - held.at >= ttlMs) return (await readList()).has(ent);
    if (held.ids.has(ent)) return true;
    // A miss: an enterprise made a moment ago works at once, when the list is old enough to be read again. A flood of bad ids reads it
    // at most once in missMs.
    if (now() - held.at >= missMs) return (await readList()).has(ent);
    return false;
  }

  return {
    stub: (ent) => o.stubFor(ent),

    async listedStub(ent) {
      if (!isEnterpriseId(ent)) return null;
      if (!(await isListed(ent))) return null;
      return { ent, stub: o.stubFor(ent) };
    },

    async addressStub(address) {
      if (!isAddressName(address)) return null;
      const held = cache.addresses.get(address);
      const fresh = held && now() - held.at < (held.ent === null ? missMs : ttlMs);
      let ent: EnterpriseId | null;
      if (held && fresh) {
        ent = held.ent;
      } else {
        ent = (await o.platform.resolveAddress({ address }))?.ent ?? null;
        cache.addresses.set(address, { at: now(), ent });
        // The cache holds a bounded number of names, so a flood of unknown addresses cannot fill the memory of the isolate.
        if (cache.addresses.size > 256) cache.addresses.delete(cache.addresses.keys().next().value as string);
      }
      return ent === null ? null : { ent, stub: o.stubFor(ent) };
    },
  };
}

export type McpAddress = { address: string | null; rest: string } | 'bad';

/**
 * The enterprise address of an MCP path (Madar enterprises, design 5.5). /mcp serves VADOs' Companies. /mcp/<address>/... serves the
 * enterprise of that address; rest is the path with the address taken out, which the MCP app routes. A first segment that starts with a
 * dot (the discovery documents) or equals oauth (the OAuth routes) or oauth-protected-resource (the resource metadata) is a path word of
 * the VADO address. Any other first segment that is no
 * address name is bad: capitals, one letter, an encoded letter, a reserved word.
 */
export function mcpAddressOf(pathname: string): McpAddress {
  if (pathname === '/mcp' || pathname === '/mcp/') return { address: null, rest: '/mcp' };
  if (!pathname.startsWith('/mcp/')) return 'bad';
  const tail = pathname.slice('/mcp/'.length);
  const slash = tail.indexOf('/');
  const first = slash < 0 ? tail : tail.slice(0, slash);
  if (first.startsWith('.') || first === 'oauth' || first === 'oauth-protected-resource') return { address: null, rest: pathname };
  if (!isAddressName(first)) return 'bad';
  return { address: first, rest: `/mcp${slash < 0 ? '' : tail.slice(slash)}` };
}
