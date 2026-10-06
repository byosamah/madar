import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Checks a finished build (plan, section 3, rule 5).
 * remote: no sample office and no relative ./assets/ path in index.html, because path links need base '/'.
 * The sample office check looks for names from src/data/seed.ts: minification renames buildSeed, but string literals stay.
 * prototype: no Supabase code and no _headers file, so the artifact stays a static page with the fake API.
 * server: no sample office and no settleFuture in the function bundles, which run on the real office (cleanup 2026-10-06).
 * It prints every search, so a search with no match is visible.
 */
export type BundleKind = 'remote' | 'prototype' | 'server';
export type BundleCheck = { ok: boolean; lines: string[] };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Names that only the sample office holds (src/data/seed.ts). A test checks that the seed still holds each one. */
export const SEED_MARKERS = ['Hala Nasser', 'Faisal Al-Harbi', 'Corniche Office Tower'] as const;

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

  const seedHits = () => texts.filter((f) => SEED_MARKERS.some((m) => f.text.includes(m))).map((f) => f.name);
  if (kind === 'server') {
    report(`the sample office (${SEED_MARKERS.map((m) => `'${m}'`).join(', ')})`, seedHits());
    report("'settleFuture'", texts.filter((f) => f.text.includes('settleFuture')).map((f) => f.name));
  } else if (kind === 'remote') {
    report(`the sample office (${SEED_MARKERS.map((m) => `'${m}'`).join(', ')})`, seedHits());
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

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const kind = process.argv[2];
  if (kind !== 'remote' && kind !== 'prototype' && kind !== 'server') {
    console.error('Usage: node scripts/check-bundles.ts <remote|prototype|server> [dist folder]');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  // The server check reads both outputs of npm run build:server: the Supabase functions and the Workers fallback.
  const folders = process.argv[3] ? [process.argv[3]] : kind === 'server' ? [join(root, 'supabase/functions/_build'), join(root, 'dist-server')] : [join(root, 'dist')];
  const results = folders.map((folder) => checkBundles(kind, folder));
  const ok = results.every((result) => result.ok);
  for (const result of results) for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  console.log(ok ? `Bundle check (${kind}) passed.` : `Bundle check (${kind}) failed.`);
  process.exit(ok ? 0 : 1);
}
