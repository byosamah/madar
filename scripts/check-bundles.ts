import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Checks a finished build (plan, section 3, rule 5).
 * remote: no sample office and no relative ./assets/ path in index.html, because path links need base '/'.
 * The sample office check looks for names from src/data/seed.ts: minification renames buildSeed, but string literals stay.
 * remote, the first load (performance audit 2026-10-07): the scripts that index.html starts hold no chart code and stay
 * under FIRST_LOAD_MAX_BYTES.
 * prototype: no Supabase code, no _headers file, one script file, and none of the links of the remote build, so the
 * artifact stays a static page with the fake API.
 * server: no sample office and no settleFuture in the function bundles, which run on the real office (cleanup 2026-10-06).
 * It prints every search, so a search with no match is visible.
 */
export type BundleKind = 'remote' | 'prototype' | 'server';
export type BundleCheck = { ok: boolean; lines: string[] };
export type BundleOptions = {
  /**
   * The rules of the first load of the remote build. The script always gives them. Without them (the tests of the older
   * rules), the check prints that it skipped them.
   */
  firstLoad?: Record<string, never>;
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Names that only the sample office holds (src/data/seed.ts). A test checks that the seed still holds each one. */
export const SEED_MARKERS = ['Hala Nasser', 'Faisal Al-Harbi', 'Corniche Office Tower'] as const;

/** The size limit of the scripts of the first load of the remote build (BND-1: about 1,294,000 B after the split). */
export const FIRST_LOAD_MAX_BYTES = 1_350_000;

/** Text that only the chart package (recharts) holds. */
export const CHART_MARKER = 'recharts-wrapper';

const TEXT = /\.(html|js|mjs|css|json|txt|map|svg|webmanifest)$/;

type Tag = { name: string; attrs: Record<string, string | true> };

/** The link and script tags of an HTML text, with their attributes. A bare attribute (crossorigin) is true. */
export function tagsOf(html: string): Tag[] {
  return [...html.matchAll(/<(link|script)\b([^>]*)>/gi)].map((match) => {
    const attrs: Record<string, string | true> = {};
    for (const attr of match[2].matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? true;
    }
    return { name: match[1].toLowerCase(), attrs };
  });
}

/** The chunks that a chunk imports statically ("./x.js"). The dynamic imports (import(`./x.js`)) are not in the list. */
export function staticImports(code: string): string[] {
  return [...new Set([...code.matchAll(/(?:import|export)\s*(?:[\w${},\s*]+from\s*)?["']\.\/([\w.-]+\.js)["']/g)].map((match) => match[1]))];
}

/** The assets/ name of an index.html link (/assets/x.js), else undefined. */
const assetOf = (href: unknown): string | undefined => (typeof href === 'string' ? /^\/?assets\/([^/?#]+)$/.exec(href)?.[1] : undefined);

/** The script files that a chunk runs with its static imports, the chunk included. */
function closureOf(roots: string[], scripts: Map<string, string>): string[] {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    stack.push(...staticImports(scripts.get(name) ?? ''));
  }
  return [...seen];
}

export function checkBundles(kind: BundleKind, dir: string, options: BundleOptions = {}): BundleCheck {
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
  /** A rule with a result to name: ok with what it found, or FAIL with what is wrong. */
  const rule = (label: string, problems: string[], found: string) => {
    if (problems.length === 0) lines.push(`ok: ${label}: ${found}.`);
    else {
      ok = false;
      lines.push(`FAIL: ${label}: ${problems.join('; ')}.`);
    }
  };
  const index = texts.find((f) => f.name === 'index.html');
  const tags = index ? tagsOf(index.text) : [];
  const rels = (rel: string) => tags.filter((tag) => tag.name === 'link' && tag.attrs.rel === rel);
  const scripts = new Map(texts.filter((f) => /^assets\/[^/]+\.js$/.test(f.name)).map((f) => [f.name.slice('assets/'.length), f.text]));

  const seedHits = () => texts.filter((f) => SEED_MARKERS.some((m) => f.text.includes(m))).map((f) => f.name);
  if (kind === 'server') {
    report(`the sample office (${SEED_MARKERS.map((m) => `'${m}'`).join(', ')})`, seedHits());
    report("'settleFuture'", texts.filter((f) => f.text.includes('settleFuture')).map((f) => f.name));
  } else if (kind === 'remote') {
    report(`the sample office (${SEED_MARKERS.map((m) => `'${m}'`).join(', ')})`, seedHits());
    if (!index) {
      ok = false;
      lines.push(`FAIL: ${dir} has no index.html.`);
    } else {
      report("a relative './assets/' path in index.html", /(src|href)=["']\.\/assets\//.test(index.text) ? ['index.html'] : []);
      if (options.firstLoad) checkFirstLoad();
      else lines.push('skip: no first-load options given, so the first-load rules did not run.');
    }
  } else {
    report("'supabase' (any case)", texts.filter((f) => /supabase/i.test(f.text)).map((f) => f.name));
    report("a '_headers' file", names.filter((name) => name === '_headers' || name.endsWith('/_headers')));
    const js = names.filter((name) => name.endsWith('.js'));
    rule('the prototype is one script file', js.length === 1 ? [] : [`${js.length} script files (${js.join(', ')})`], js.join(', '));
    const early = ['modulepreload', 'preload', 'preconnect'].flatMap((rel) => rels(rel).map(() => rel));
    rule('the prototype index.html starts no early load', early.length === 0 ? [] : [`it holds ${early.join(', ')} links`], 'no modulepreload, preload or preconnect link');
  }
  return { ok, lines };

  /** BND-1: the scripts that index.html starts, and what they hold. */
  function checkFirstLoad(): void {
    const entries = tags.filter((tag) => tag.name === 'script' && tag.attrs.type === 'module').map((tag) => assetOf(tag.attrs.src));
    const preloads = rels('modulepreload').map((tag) => assetOf(tag.attrs.href));
    const linked = [...entries, ...preloads].filter((name): name is string => name !== undefined);
    const missing = linked.filter((name) => !scripts.has(name));
    rule('every script that index.html starts is in assets/', missing.map((name) => `${name} is missing`), `${linked.length} scripts`);
    if (entries.length !== 1) rule('index.html starts one entry script', [`it starts ${entries.length}`], '');
    const closure = closureOf(linked, scripts);
    const bytes = closure.reduce((sum, name) => sum + Buffer.byteLength(scripts.get(name) ?? ''), 0);
    const none = (label: string, markers: string[]) => {
      const hits = closure.filter((name) => markers.some((marker) => scripts.get(name)?.includes(marker)));
      rule(`no ${label} in the first-load scripts`, hits.length > 0 ? [`found in ${hits.join(', ')}`] : [], `searched ${closure.length} files, no match`);
    };
    none(`chart code ('${CHART_MARKER}')`, [CHART_MARKER]);
    rule(
      `the first-load scripts stay at ${FIRST_LOAD_MAX_BYTES} B or less`,
      bytes > FIRST_LOAD_MAX_BYTES ? [`${closure.length} files hold ${bytes} B`] : [],
      `${closure.length} files, ${bytes} B`,
    );
  }
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
  const options: BundleOptions = { firstLoad: {} };
  const results = folders.map((folder) => checkBundles(kind, folder, options));
  const ok = results.every((result) => result.ok);
  for (const result of results) for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  console.log(ok ? `Bundle check (${kind}) passed.` : `Bundle check (${kind}) failed.`);
  process.exit(ok ? 0 : 1);
}
