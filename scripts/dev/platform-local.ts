/**
 * npm run dev:platform (Madar enterprises, plan F): the built site of the platform (dist-platform) on 127.0.0.1:4175, with /api/platform and
 * everything under it handed to the local office Worker (npm run dev:office, 127.0.0.1:8792). It does what the Pages project madar-platform
 * does in production: static files with the headers of config/headers.platform, and the platform routes sent on to the Worker. Run
 * npm run build:platform and npm run dev:office first. The sandbox must be off (the server binds a port). Ctrl-C stops it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_OFFICE } from './office-local';

export const LOCAL_PLATFORM = 'http://127.0.0.1:4175';
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
/** The hop headers that a forward never copies. */
const HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade']);

/** True for the platform routes: /api/platform and every path below it. */
export function isPlatformRoute(pathname: string): boolean {
  return pathname === '/api/platform' || pathname.startsWith('/api/platform/');
}

/** The header lines of the `/*` block of a Pages _headers file. */
export function headersOf(text: string): [string, string][] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === '/*');
  if (start === -1) return [];
  const out: [string, string][] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    const at = line.indexOf(':');
    if (at > 0) out.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return out;
}

/** The file for a path under root, or null when the path leaves root or holds no file. */
export function fileOf(root: string, pathname: string): string | null {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, clean);
  if (!file.startsWith(root)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

/** The request handler: the platform routes go to the upstream Worker, any other path is a file of the site (the one page answers an unknown path). */
export function platformLocalHandler(o: { root: string; upstream: string; fetch?: typeof fetch }): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const send = o.fetch ?? fetch;
  const headersFile = join(o.root, '_headers');
  const fixed = existsSync(headersFile) ? headersOf(readFileSync(headersFile, 'utf8')) : [];
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (isPlatformRoute(url.pathname)) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (!HOP.has(name) && typeof value === 'string') headers.set(name, value);
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const answer = await send(new URL(url.pathname + url.search, o.upstream), { method: req.method, headers, ...(hasBody ? { body: Buffer.concat(chunks) } : {}) });
      res.statusCode = answer.status;
      answer.headers.forEach((value, name) => { if (!HOP.has(name) && name !== 'content-encoding') res.setHeader(name, value); });
      res.end(Buffer.from(await answer.arrayBuffer()));
      return;
    }
    const file = fileOf(o.root, url.pathname) ?? (extname(url.pathname) === '' ? join(o.root, 'index.html') : null);
    if (!file || !existsSync(file)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    for (const [name, value] of fixed) res.setHeader(name, value);
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  };
}

export function platformLocalServer(o: { root: string; upstream: string; fetch?: typeof fetch }): Server {
  const handle = platformLocalHandler(o);
  return createServer((req, res) => {
    handle(req, res).catch(() => {
      res.statusCode = 502;
      res.end('The office did not answer.');
    });
  });
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const root = realpathSync(fileURLToPath(new URL('../../dist-platform', import.meta.url)));
  platformLocalServer({ root, upstream: LOCAL_OFFICE }).listen(4175, '127.0.0.1', () => console.log(`The platform site on ${LOCAL_PLATFORM}, /api/platform goes to ${LOCAL_OFFICE}. Ctrl-C stops it.`));
}
