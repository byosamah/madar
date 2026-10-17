import { execFileSync } from 'node:child_process';
import { defineConfig, type EnvironmentOptions } from 'vite';

/**
 * The release of the server bundle: "1.0.<number of commits>", so each commit gives a higher version (owner, 2026-10-12). The MCP
 * server names it in serverInfo (server/mcp/app.ts). A client such as claude.ai keeps its tool list for one server version, and a
 * fixed "1.0.0" kept the new tools away from it. A deploy builds a committed tree only, so the number belongs to that commit.
 * With no git (or no count), "1.0.0". check-bundles.ts fails a bundle that still holds the placeholder.
 */
export function releaseVersion(countCommits: () => string = () => execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })): string {
  try {
    const count = Number(countCommits().trim());
    return Number.isInteger(count) && count > 0 ? `1.0.${count}` : '1.0.0';
  } catch {
    return '1.0.0';
  }
}

/**
 * The server bundle (plan, section 3, "How the server runs the shared code on Deno"; plan 2b, point 2).
 * The handlers use extensionless relative imports, which Deno does not resolve, so each entry becomes one ESM file:
 *   supabase/functions/_build/{api,mcp,jobs}.js  for Supabase Edge Functions (Deno); each function's deno.json maps pg to npm:pg
 *   dist-server/worker.js                        for Cloudflare Workers, the fallback host; Wrangler resolves pg from node_modules
 * Every library is inside the bundle except pg and the node: modules, which each host provides. One file for each entry: no
 * shared chunks, so a function never imports a file that its deploy leaves out.
 * The bundles are minified, with the names of functions and classes kept, so a new worker starts faster (performance audit
 * SRV-11). Minify drops the JSDoc comments too, which Deno cannot read (proof.md G3).
 */

const EXTERNAL = ['pg', /^node:/];

export function serverEntry(name: string, input: string, outDir: string, conditions: string[], more: string[] = []): EnvironmentOptions {
  return {
    consumer: 'server',
    resolve: { conditions, externalConditions: conditions, noExternal: true, external: ['pg', ...more] },
    build: {
      outDir,
      emptyOutDir: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      copyPublicDir: false,
      rollupOptions: {
        input: { [name]: input },
        external: [...EXTERNAL, ...more],
        // keepNames: the error classes name themselves from their constructor, and check-bundles finds settleFuture by its name.
        output: { format: 'es', entryFileNames: `${name}.js`, codeSplitting: false, keepNames: true, comments: { legal: true, annotation: true, jsdoc: false } },
      },
    },
  };
}

export const DENO = ['deno', 'worker', 'import', 'module', 'default'];
const WORKERD = ['workerd', 'worker', 'import', 'module', 'default'];

export default defineConfig({
  // The build flag of the screens means nothing on the server; the shared code never reads it, and this keeps it fixed.
  define: { 'import.meta.env.VITE_MADAR_API': JSON.stringify('remote'), __MADAR_SERVER_VERSION__: JSON.stringify(releaseVersion()) },
  publicDir: false,
  environments: {
    api: serverEntry('api', 'server/entries/deno-api.ts', 'supabase/functions/_build', DENO),
    mcp: serverEntry('mcp', 'server/entries/deno-mcp.ts', 'supabase/functions/_build', DENO),
    jobs: serverEntry('jobs', 'server/entries/deno-jobs.ts', 'supabase/functions/_build', DENO),
    // The Workers bundle starts at workerMain.ts, which exports the office object (exit wave 3). workerd provides cloudflare:workers.
    worker: serverEntry('worker', 'server/entries/workerMain.ts', 'dist-server', WORKERD, ['cloudflare:workers']),
  },
  builder: {
    async buildApp(builder) {
      for (const name of ['api', 'mcp', 'jobs', 'worker']) await builder.build(builder.environments[name]);
    },
  },
});
