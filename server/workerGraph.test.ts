import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * "wrangler dev" bundles a Workers entry from its TypeScript with esbuild, not with Vite (server/it/workerdb.it.test.ts). esbuild has
 * no import.meta.glob, so a module that the entry loads at once and that calls it stops the Worker at start ("glob is not a
 * function"). Server code reads its word files with plain JSON imports (server/mail/templates/words.ts).
 */

const ROOT = new URL('../', import.meta.url);
const STATIC_IMPORT = /^(?:import|export)\s+(?!type\s)(?:[^;'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm;

/** Every file of the repository that loading this file loads at once, by path from the root. dynamic import() is left out. */
function staticGraph(start: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const [, spec] of readFileSync(new URL(file, ROOT), 'utf8').matchAll(STATIC_IMPORT)) {
      const base = new URL(spec, new URL(file, ROOT)).pathname.slice(ROOT.pathname.length);
      const found = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find((path) => /\.tsx?$/.test(path) && existsSync(new URL(path, ROOT)));
      if (found && !seen.has(found)) {
        seen.add(found);
        queue.push(found);
      }
    }
  }
  return seen;
}

describe('the Workers entry and esbuild', () => {
  it('loads no module that calls import.meta.glob', () => {
    const graph = staticGraph('server/entries/worker.ts');
    // The walk reaches the dependencies, so an empty walk cannot pass.
    expect(graph).toContain('server/core/deps.ts');
    const glob = [...graph].filter((file) => readFileSync(new URL(file, ROOT), 'utf8').includes('import.meta.glob('));
    expect(glob).toEqual([]);
  });
});

/**
 * settleFuture moves every stamp later than now to before now. It is right for the sample office and wrong for a real one, so
 * the server bundles hold neither the sample office nor that step: no path on a real office can run them (cleanup 2026-10-06).
 * The prototype runtime gives the sample office to session.resetSampleData (src/data/sampleOffice.ts).
 */
describe('the server entries and the sample office', () => {
  it.each(['server/entries/deno-api.ts', 'server/entries/deno-mcp.ts', 'server/entries/deno-jobs.ts', 'server/entries/worker.ts', 'server/entries/workerMain.ts'])('%s loads no sample office and no settleFuture', (entry) => {
    const graph = staticGraph(entry);
    expect(graph).toContain('src/api/handlers/system.ts');
    expect([...graph].filter((file) => file.startsWith('src/data/'))).toEqual([]);
  });
});

describe('the office object in the bundles (exit wave 3)', () => {
  it('only the Workers bundle reaches the office object; no Supabase function does', () => {
    expect(staticGraph('server/entries/workerMain.ts')).toContain('server/office/office.ts');
    for (const entry of ['server/entries/deno-api.ts', 'server/entries/deno-mcp.ts', 'server/entries/deno-jobs.ts', 'server/entries/worker.ts']) {
      expect([...staticGraph(entry)].filter((file) => file.startsWith('server/office/')), entry).toEqual([]);
    }
  });

  it('the Workers bundle holds no test code', () => {
    expect([...staticGraph('server/entries/workerMain.ts')].filter((file) => file.includes('/test/'))).toEqual([]);
  });
});

/**
 * The own sign-in (Supabase exit, wave 2) runs in the office object. bcryptjs imports the bare module "crypto", which the
 * Supabase functions on Deno may not load, so no Supabase entry loads a file of server/auth/own/ or server/mcp/oauth/. The hosts
 * of wave 3 pass the own routes in (AppOptions.routes, McpAppOptions.oauth).
 */
describe('the Supabase entries and the own sign-in', () => {
  // The anchor of each walk is a sign-in file that the entry loads and that wave 2 changes, so an empty walk cannot pass. The jobs
  // entry checks no token, so it loads the auth effects and not verify.ts.
  it.each([
    ['server/entries/deno-api.ts', 'server/auth/verify.ts'],
    ['server/entries/deno-mcp.ts', 'server/auth/verify.ts'],
    ['server/entries/deno-jobs.ts', 'server/auth/effects.ts'],
  ])('%s loads no file of the own sign-in', (entry, anchor) => {
    const graph = staticGraph(entry);
    expect(graph).toContain(anchor);
    expect([...graph].filter((file) => file.startsWith('server/auth/own/') || file.startsWith('server/mcp/oauth/'))).toEqual([]);
  });
});
