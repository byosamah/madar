import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The site Madar enterprises holds no company code (design 12, D7 and D9). This test follows every import of src/platform/main.tsx (the files of the
 * site, with no test) and fails on a file of the companies' app: the runtime, the routes, the shell, the remote client, the sample office, the company
 * screens and the registry of the company calls. The bundle check says the same about the finished build (scripts/check-bundles.ts, platform).
 */
const ROOT = resolve(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(candidate)) return candidate;
  return null;
}

/** The local files that a file imports as values or loads on demand. A type-only import is gone after the build, so it does not count. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specs = [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'";]*?from\s*['"](\.[^'"]+)['"]/g), ...source.matchAll(/(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g), ...source.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  return specs.flatMap((spec) => {
    const found = resolveImport(file, spec);
    return found ? [found] : [];
  });
}

function closure(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...importsOf(file));
  }
  return [...seen].map((file) => relative(SRC, file).split('\\').join('/')).sort();
}

/** What the site may use from outside src/platform: shared parts that know no company runtime. */
const ALLOWED = [
  /^platform\//,
  /^components\//,
  /^design\//,
  /^lib\//,
  /^features\/enterprises\//, // the logo, the logo picker and the limits: the Admin of a company uses them too
  /^app\/(appearance|errors|lang|toasts|privateMark|panelOpen|useIsPhone)\.tsx?$/,
  /^api\/(errors|remote\/errors)\.ts$/,
  /^api\/contract\/(limits|entities|platform)\.ts$/,
  /^i18n\/(mergeWords)\.ts$/,
  /^i18n\/(en|ar)\.json$/,
  /^i18n\/real\//,
];

describe('the site Madar enterprises', () => {
  const files = closure(join(SRC, 'platform', 'main.tsx'));

  it('imports only shared parts and its own files', () => {
    const outside = files.filter((file) => !ALLOWED.some((rule) => rule.test(file)));
    expect(outside).toEqual([]);
  });

  it('imports none of the runtime, the routes, the shell, the remote client, the registry, the store or the sample office', () => {
    const banned = /^(app\/(runtime|routes|screens|screenLoaders|bootstrap|useRight|RouteError)|app\/remote\/|api\/(calls|client|registry|store|execute|persist|handlers\/|remote\/(remoteApi|batcher|wire))|data\/|features\/(?!enterprises\/))/;
    expect(files.filter((file) => banned.test(file))).toEqual([]);
  });

  it('has the files of the site in the closure (the test reads the right entry)', () => {
    for (const file of ['platform/main.tsx', 'platform/client.ts', 'platform/PlatformApp.tsx', 'platform/EnterprisesScreen.tsx', 'components/Sheet.tsx']) expect(files).toContain(file);
  });

  it('is not imported by the companies app: no file outside src/platform names it', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
    const users = walk(SRC)
      .filter((file) => /\.tsx?$/.test(file) && !file.startsWith(join(SRC, 'platform')))
      .filter((file) => /from\s*['"][./]*\/platform\/|import\(\s*['"][./]*\/platform\//.test(readFileSync(file, 'utf8')));
    expect(users.map((file) => relative(SRC, file))).toEqual([]);
  });
});
