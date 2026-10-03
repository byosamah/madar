import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
