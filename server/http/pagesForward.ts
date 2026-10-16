/**
 * The shared parts of the two Pages Functions of the page host (owner, 2026-10-16): /api (pagesApiProxy.ts) and /mcp
 * (pagesMcpProxy.ts). Each one goes to the Worker of its copy through a service binding when config/server-host.json says
 * workers, and to the Supabase function of its copy otherwise.
 */

/** A Pages service binding to a Worker (Settings, Bindings of the Pages project madar). */
export type ServiceBinding = { fetch(request: Request): Promise<Response> };
/** The env of a Pages Function: its bindings by name. */
export type PagesEnv = Record<string, unknown>;

/**
 * The client address that the forwarder writes for the Worker, from its own cf-connecting-ip. Only the forwarder reaches the
 * Worker, so the Worker trusts this header and nothing else (server/auth/forgot.ts, clientAddress).
 */
export const CLIENT_ADDRESS_HEADER = 'x-madar-client-address';

/** The address of a request through a binding. The Worker routes by path only; this host never reaches the internet. */
export const INTERNAL_ORIGIN = 'https://madar-server.internal';

/**
 * Headers that never go on: those of one connection, those of a client address (only the forwarder writes the address for the
 * Worker), and the hop tag of the mcp function. fetch decodes the answer itself, so accept-encoding goes too. Every cf-* header
 * goes as well: Supabase sits behind Cloudflare and refuses a request that carries its own cf-connecting-ip (proof.md Z0b).
 */
const REQUEST_SKIP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'keep-alive',
  'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'true-client-ip', 'x-madar-hop', 'x-madar-client-address',
]);
/** fetch already decoded the body of the answer, so its encoding and length no longer hold. */
const RESPONSE_SKIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

/** The headers of the request that go on to the next host. */
export function forwardHeaders(request: Request): Headers {
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (!REQUEST_SKIP.has(key) && !key.startsWith('cf-')) headers.set(key, value);
  });
  return headers;
}

/** Encoded dots, encoded slashes and backslashes could become a path outside the target upstream (security review). */
export function unsafeSuffix(suffix: string): boolean {
  return /%2e|%2f|%5c|\\/i.test(suffix);
}

/** The binding of that name, when the Pages env has one that can fetch. */
export function bindingOf(env: PagesEnv | undefined, name: string): ServiceBinding | undefined {
  const value = env?.[name] as { fetch?: unknown } | undefined;
  return value !== null && typeof value === 'object' && typeof value.fetch === 'function' ? (value as ServiceBinding) : undefined;
}

/** The init of the request to the next host: the method, the headers and the body as a stream. */
export function forwardInit(request: Request, headers: Headers): RequestInit {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit;
}

/** The answer of the next host as a stream, without the headers that no longer hold. */
export function answerOf(answer: Response): Response {
  const out = new Headers();
  answer.headers.forEach((value, name) => {
    if (!RESPONSE_SKIP.has(name.toLowerCase())) out.set(name, value);
  });
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: out });
}

/** Why a request went to the Supabase function: the setting says supabase, or the binding of the Worker is missing. */
export type FallbackReason = 'setting' | 'binding_missing';

/** One JSON line for the Pages log: info when the setting asks for Supabase, a warning when the binding is missing. */
export function fallbackLine(message: string, copy: string, reason: FallbackReason): string {
  return JSON.stringify({ level: reason === 'setting' ? 'info' : 'warn', message, copy, reason });
}

export const defaultLog = (line: string): void => {
  const level = (JSON.parse(line) as { level?: string }).level;
  if (level === 'warn') console.warn(line);
  else console.log(line);
};
