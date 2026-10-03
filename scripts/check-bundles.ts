import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Checks a finished build (plan, section 3, rule 5).
 * remote: no sample office (buildSeed) and no relative ./assets/ path in index.html, because path links need base '/'.
 * prototype: no Supabase code and no _headers file, so the artifact stays a static page with the fake API.
 * It prints every search, so a search with no match is visible.
 */
export type BundleKind = 'remote' | 'prototype';
export type BundleCheck = { ok: boolean; lines: string[] };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const TEXT = /\.(html|js|mjs|css|json|txt|map|svg|webmanifest)$/;

export function checkBundles(kind: BundleKind, dir: string): BundleCheck {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: false, lines: [`FAIL: ${dir} does not exist. Build first.`] };
  }
  const files = walk(dir);
  const names = files.map((file) => relative(dir, file).split('\\').join('/'));
  const texts = files.map((file, i) => ({ name: names[i], text: TEXT.test(file) || !names[i].includes('.') ? readFileSync(file, 'utf8') : '' }));
  const lines: string[] = [];
  let ok = true;
  const report = (label: string, hits: string[]) => {
    if (hits.length === 0) lines.push(`ok: searched ${files.length} files in ${dir} for ${label}: no match.`);
    else {
      ok = false;
      lines.push(`FAIL: ${label} found in: ${hits.join(', ')}`);
    }
  };

  if (kind === 'remote') {
    report("'buildSeed'", texts.filter((f) => f.text.includes('buildSeed')).map((f) => f.name));
    const index = texts.find((f) => f.name === 'index.html');
    if (!index) {
      ok = false;
      lines.push(`FAIL: ${dir} has no index.html.`);
    } else {
      report("a relative './assets/' path in index.html", /(src|href)=["']\.\/assets\//.test(index.text) ? ['index.html'] : []);
    }
  } else {
    report("'supabase' (any case)", texts.filter((f) => /supabase/i.test(f.text)).map((f) => f.name));
    report("a '_headers' file", names.filter((name) => name === '_headers' || name.endsWith('/_headers')));
  }
  return { ok, lines };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const kind = process.argv[2];
  if (kind !== 'remote' && kind !== 'prototype') {
    console.error('Usage: node scripts/check-bundles.ts <remote|prototype> [dist folder]');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = checkBundles(kind, process.argv[3] ?? join(root, 'dist'));
  for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  console.log(result.ok ? `Bundle check (${kind}) passed.` : `Bundle check (${kind}) failed.`);
  process.exit(result.ok ? 0 : 1);
}
