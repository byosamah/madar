import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBuilder } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { checkBundles } from '../../scripts/check-bundles';
import { DENO, serverEntry } from '../../vite.server.config';

/**
 * Each Supabase function bundle holds only its own app (review of E, 2026-10-03): the api function, the main path of the
 * screens, must not carry the MCP SDK or the job code, because each extra module costs CPU at a cold start (risk 3).
 * Rolldown cannot leave out a module that the entry imports, so this test walks the imports of each entry. A type-only import
 * leaves nothing in the bundle and is skipped.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const IMPORT = /^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function resolveFile(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  for (const path of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(path) && path.match(/\.tsx?$/)) return path;
  return undefined;
}

/** The project files (relative to the root) and the packages that the entry reaches. */
function graphOf(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [resolve(ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    const name = relative(ROOT, file);
    if (files.has(name)) continue;
    files.add(name);
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const spec = match[1];
      if (spec.startsWith('.')) {
        const next = resolveFile(file, spec);
        if (next) queue.push(next);
      } else {
        packages.add(spec);
      }
    }
  }
  return { files, packages };
}

const MCP = 'server/mcp/app.ts';
const JOBS = 'server/jobs/app.ts';
const API = 'server/http/app.ts';
const BATCH = 'server/http/batch.ts';

describe('the function bundles', () => {
  it('the api entry reaches the api app and neither the MCP app, its SDK, nor the job app', () => {
    const { files, packages } = graphOf('server/entries/deno-api.ts');
    expect(files).toContain(API);
    expect(files).toContain(BATCH);
    expect(files).not.toContain(MCP);
    expect(files).not.toContain(JOBS);
    expect([...packages].filter((p) => p.startsWith('@modelcontextprotocol/'))).toEqual([]);
  });

  it('the mcp entry reaches the MCP app and neither the batch route nor the job app', () => {
    const { files } = graphOf('server/entries/deno-mcp.ts');
    expect(files).toContain(MCP);
    for (const other of [API, BATCH, JOBS]) expect(files).not.toContain(other);
  });

  it('the jobs entry reaches the job app and neither the batch route nor the MCP app', () => {
    const { files, packages } = graphOf('server/entries/deno-jobs.ts');
    expect(files).toContain(JOBS);
    for (const other of [API, BATCH, MCP]) expect(files).not.toContain(other);
    expect([...packages].filter((p) => p.startsWith('@modelcontextprotocol/'))).toEqual([]);
  });

  it('the Workers entry reaches all three apps', () => {
    const { files } = graphOf('server/entries/worker.ts');
    for (const app of [API, MCP, JOBS]) expect(files).toContain(app);
  });
});

/**
 * The function bundles are minified and keep the names of functions and classes (performance audit SRV-11). The names matter
 * twice: the error classes of jose and the SDK name themselves from their constructor, and scripts/check-bundles.ts finds a
 * leaked settleFuture by its name. The builds go to test-results (git-ignored), with the options of vite.server.config.ts.
 */
describe('the minified function bundles (performance audit SRV-11)', () => {
  const OUT = join(ROOT, 'test-results', `bundles-test-${process.pid}`);
  afterAll(() => rmSync(OUT, { recursive: true, force: true }));

  async function build(name: string, input: string, outDir: string): Promise<string> {
    const builder = await createBuilder({ root: ROOT, configFile: false, logLevel: 'silent', environments: { [name]: serverEntry(name, input, outDir, DENO) } });
    await builder.build(builder.environments[name]);
    return join(outDir, `${name}.js`);
  }

  /** A file of its own with the given text, built as one server entry. */
  async function buildFixture(name: string, text: string): Promise<string> {
    const dir = join(OUT, name);
    mkdirSync(dir, { recursive: true });
    const input = join(dir, 'input.ts');
    writeFileSync(input, text);
    return build(name, input, join(dir, 'out'));
  }

  it('makes the server bundles minified, with names kept and the JSDoc comments that Deno cannot read left out (proof.md G3)', () => {
    const entry = serverEntry('api', 'server/entries/deno-api.ts', 'out', DENO);
    expect(entry.build?.minify).toBe(true);
    expect(entry.build?.rollupOptions?.output).toMatchObject({ keepNames: true, comments: { legal: true, annotation: true, jsdoc: false } });
  });

  it('keeps the name of a function that leaked in, so the server check still finds settleFuture', async () => {
    const file = await buildFixture('leak', `
      type Rec = { stamp: string; next?: Rec };
      function settleFuture(rec: Rec, at: number): Rec {
        let floor = 0;
        for (let r: Rec | undefined = rec; r; r = r.next) floor = Math.max(floor, Date.parse(r.stamp));
        return floor > at ? { ...rec, stamp: new Date(at).toISOString() } : rec;
      }
      export const run = (rec: Rec) => settleFuture(rec, Date.now());
      export const again = (rec: Rec, at: number) => settleFuture(settleFuture(rec, at), at - 1);
    `);
    expect(readFileSync(file, 'utf8').split('\n').length).toBeLessThan(10);
    const check = checkBundles('server', dirname(file));
    expect(check.ok).toBe(false);
    expect(check.lines.join('\n')).toContain("FAIL: 'settleFuture' found in: leak.js");
  });

  it('keeps the name of an error class that names itself from its constructor, as jose does (JWTExpired)', async () => {
    const file = await buildFixture('names', `
      class JOSEError extends Error {
        code = 'ERR_JOSE_GENERIC';
        constructor(message: string) {
          super(message);
          this.name = this.constructor.name;
        }
      }
      export class JWTExpired extends JOSEError {
        code = 'ERR_JWT_EXPIRED';
      }
      export function expired(): Error {
        return new JWTExpired('"exp" claim timestamp check failed');
      }
    `);
    const { expired } = (await import(pathToFileURL(file).href)) as { expired: () => Error };
    expect(expired().name).toBe('JWTExpired');
  });

  it('builds the api bundle minified, and it still answers a preflight', async () => {
    const file = await build('api', 'server/entries/deno-api.ts', join(OUT, 'api'));
    const text = readFileSync(file, 'utf8');
    // The bound proves the minify: a bundle that is not minified is far larger. The chat batch of 2026-10-19 (search, the push rules,
    // edit and delete, Notify me) took the minified bundle from about 688,000 to 711,111 characters, so the bound is 760,000.
    // The Google Calendar sync and its client (fbk_022) added about 26,000 on their own branch (713,337 there). Both together after the join of 2026-10-20: 748,238.
    // The join as a helper and the lead delete (fbk_034, fbk_035) on top of the later fixes: 760,035, so the bound is 800,000.
    expect(text.length).toBeLessThan(800_000);
    expect(text.includes('JWTExpired')).toBe(true);
    expect(text.includes('@param {import(')).toBe(false);
    expect(checkBundles('server', dirname(file)).ok).toBe(true);
    const env = {
      DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres', SUPABASE_URL: 'http://127.0.0.1:54321',
      MADAR_SECRET_KEY: 'sb_secret_made_up', APP_URL: 'http://127.0.0.1:5173', MAIL_FROM: 'Madar <notices@madar.test>', MAIL_DRIVER: 'outbox',
    };
    const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
    Object.assign(process.env, env);
    try {
      const entry = ((await import(pathToFileURL(file).href)) as { default: { fetch: (request: Request) => Promise<Response> } }).default;
      const response = await entry.fetch(new Request('http://127.0.0.1/api/batch', {
        method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'POST' },
      }));
      expect(response.status).toBe(204);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
