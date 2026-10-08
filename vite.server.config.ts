import { defineConfig, type EnvironmentOptions } from 'vite';

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

export function serverEntry(name: string, input: string, outDir: string, conditions: string[]): EnvironmentOptions {
  return {
    consumer: 'server',
    resolve: { conditions, externalConditions: conditions, noExternal: true, external: ['pg'] },
    build: {
      outDir,
      emptyOutDir: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      copyPublicDir: false,
      rollupOptions: {
        input: { [name]: input },
        external: EXTERNAL,
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
  define: { 'import.meta.env.VITE_MADAR_API': JSON.stringify('remote') },
  publicDir: false,
  environments: {
    api: serverEntry('api', 'server/entries/deno-api.ts', 'supabase/functions/_build', DENO),
    mcp: serverEntry('mcp', 'server/entries/deno-mcp.ts', 'supabase/functions/_build', DENO),
    jobs: serverEntry('jobs', 'server/entries/deno-jobs.ts', 'supabase/functions/_build', DENO),
    worker: serverEntry('worker', 'server/entries/worker.ts', 'dist-server', WORKERD),
  },
  builder: {
    async buildApp(builder) {
      for (const name of ['api', 'mcp', 'jobs', 'worker']) await builder.build(builder.environments[name]);
    },
  },
});
