import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Checks a finished build (plan, section 3, rule 5).
 * remote: no sample office and no relative ./assets/ path in index.html, because path links need base '/'.
 * The sample office check looks for names from src/data/seed.ts: minification renames buildSeed, but string literals stay.
 * remote, the first load (performance audit 2026-10-07): the scripts that index.html starts hold no chart code, no zod
 * schemas and no words, and stay under FIRST_LOAD_MAX_BYTES. index.html starts the bootstrap chunk, the three Thmanyah
 * files and a connection to each Supabase origin. The vendor and supabase chunks import no app chunk, so their names stay
 * the same over a release that changes only app code.
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
  firstLoad?: {
    /** The origins that index.html connects to early (VITE_SUPABASE_URL, VITE_API_URL). None: that rule says it skips. */
    origins: string[];
    /** The folder of the Thmanyah files that the font links must match (src/design/fonts). */
    fontsDir: string;
  };
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

/** Text that only the chart package (recharts), the zod schemas and the word files hold. A test checks the word files. */
export const CHART_MARKER = 'recharts-wrapper';
export const ZOD_MARKER = '$ZodObject';
export const WORD_MARKERS = {
  en: 'Something went wrong on this page. Go to Home and try again.',
  ar: 'حدث خطأ في هذه الصفحة. انتقل إلى الرئيسية وحاول مرة أخرى.',
} as const;

/** The Thmanyah weights that index.html preloads, as named in src/design/fonts. */
export const FONT_WEIGHTS = ['Regular', 'Medium', 'Bold'] as const;

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
    // The build stamps the release version into the MCP serverInfo (vite.server.config.ts, owner 2026-10-12). A placeholder left in
    // a bundle means a fixed "1.0.0", and a client keeps its old tool list.
    report("the unstamped version '__MADAR_SERVER_VERSION__'", texts.filter((f) => f.text.includes('__MADAR_SERVER_VERSION__')).map((f) => f.name));
  } else if (kind === 'remote') {
    report(`the sample office (${SEED_MARKERS.map((m) => `'${m}'`).join(', ')})`, seedHits());
    if (!index) {
      ok = false;
      lines.push(`FAIL: ${dir} has no index.html.`);
    } else {
      report("a relative './assets/' path in index.html", /(src|href)=["']\.\/assets\//.test(index.text) ? ['index.html'] : []);
      // Browser push (owner, 2026-10-08): the Settings switch registers /sw.js, so the build must carry it.
      rule('the push service worker', names.includes('sw.js') ? [] : ['dist has no sw.js'], 'sw.js is in the build');
      if (options.firstLoad) {
        checkFirstLoad();
        checkEarlyLinks(options.firstLoad);
        checkStableChunks();
      } else lines.push('skip: no first-load options given, so the first-load rules did not run.');
    }
  } else {
    report("'supabase' (any case)", texts.filter((f) => /supabase/i.test(f.text)).map((f) => f.name));
    report("a '_headers' file", names.filter((name) => name === '_headers' || name.endsWith('/_headers')));
    // Browser push (owner, 2026-10-08): the prototype never registers the worker, and vite.config.ts drops the file.
    report("the push service worker 'sw.js'", names.filter((name) => name === 'sw.js' || name.endsWith('/sw.js')));
    report("a registration of '/sw.js'", texts.filter((f) => f.text.includes('/sw.js')).map((f) => f.name));
    const js = names.filter((name) => name.endsWith('.js'));
    rule('the prototype is one script file', js.length === 1 ? [] : [`${js.length} script files (${js.join(', ')})`], js.join(', '));
    const early = ['modulepreload', 'preload', 'preconnect'].flatMap((rel) => rels(rel).map(() => rel));
    rule('the prototype index.html starts no early load', early.length === 0 ? [] : [`it holds ${early.join(', ')} links`], 'no modulepreload, preload or preconnect link');
  }
  return { ok, lines };

  /** BND-1, BND-6, BND-7: the scripts that index.html starts, and what they hold. */
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
    none(`zod schemas ('${ZOD_MARKER}')`, [ZOD_MARKER]);
    none('words of a language', [WORD_MARKERS.en, WORD_MARKERS.ar]);
    rule(
      `the first-load scripts stay at ${FIRST_LOAD_MAX_BYTES} B or less`,
      bytes > FIRST_LOAD_MAX_BYTES ? [`${closure.length} files hold ${bytes} B`] : [],
      `${closure.length} files, ${bytes} B`,
    );
  }

  /** BND-2, BND-3, BND-4: the links that start the bootstrap chunk, the fonts and the Supabase connection with the page. */
  function checkEarlyLinks(o: NonNullable<BundleOptions['firstLoad']>): void {
    const preloads = new Set(rels('modulepreload').map((tag) => assetOf(tag.attrs.href)));
    const entry = tags.find((tag) => tag.name === 'script' && tag.attrs.type === 'module');
    const started = new Set([...preloads, assetOf(entry?.attrs.src)]);
    const boot = [...scripts.keys()].filter((name) => name.startsWith('bootstrap-'));
    if (boot.length !== 1) rule('one bootstrap chunk', [`assets/ holds ${boot.length}`], '');
    else {
      const unlinked = closureOf(boot, scripts).filter((name) => !started.has(name));
      rule('index.html starts the bootstrap chunk and its static imports', unlinked.map((name) => `no modulepreload link to ${name}`), `${boot[0]} and its imports`);
    }

    const fonts = rels('preload').filter((tag) => tag.attrs.as === 'font');
    const fontProblems: string[] = [];
    if (fonts.length !== FONT_WEIGHTS.length) fontProblems.push(`${fonts.length} font links, not ${FONT_WEIGHTS.length}`);
    for (const weight of FONT_WEIGHTS) {
      const pattern = new RegExp(`^thmanyahsans-${weight}-[\\w-]+\\.otf$`);
      const link = fonts.find((tag) => pattern.test(assetOf(tag.attrs.href) ?? ''));
      if (!link) {
        fontProblems.push(`no link to assets/thmanyahsans-${weight}-*.otf`);
        continue;
      }
      const name = `assets/${assetOf(link.attrs.href)}`;
      if (link.attrs.crossorigin === undefined) fontProblems.push(`the ${weight} link has no crossorigin`);
      if (link.attrs.type !== 'font/otf') fontProblems.push(`the ${weight} link has no type font/otf`);
      const file = files[names.indexOf(name)];
      const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
      if (!file) fontProblems.push(`${name} is missing`);
      else if (sha(file) !== sha(join(o.fontsDir, `thmanyahsans-${weight}.otf`))) fontProblems.push(`${name} differs from thmanyahsans-${weight}.otf`);
    }
    rule('index.html preloads the three Thmanyah files', fontProblems, 'each with crossorigin and the same bytes as the font folder');

    const origins = [...new Set(o.origins)];
    const connects = rels('preconnect');
    if (origins.length === 0) lines.push('skip: no Supabase origin given (VITE_SUPABASE_URL, VITE_API_URL), so the preconnect rule did not run.');
    else {
      const problems = [
        ...origins.filter((origin) => !connects.some((tag) => tag.attrs.href === origin && tag.attrs.crossorigin !== undefined)).map((origin) => `no preconnect with crossorigin to ${origin}`),
        ...connects.filter((tag) => !origins.includes(String(tag.attrs.href))).map((tag) => `a preconnect to ${String(tag.attrs.href)}`),
      ];
      rule('index.html connects early to each Supabase origin', problems, origins.join(', '));
    }
  }

  /** BND-5: the package chunks import no app chunk, so an app change keeps their names. */
  function checkStableChunks(): void {
    for (const [group, allowed] of [['vendor', ['rolldown-runtime-']], ['supabase', ['rolldown-runtime-', 'vendor-']]] as const) {
      const chunks = [...scripts.keys()].filter((name) => name.startsWith(`${group}-`));
      if (chunks.length !== 1) {
        rule(`one ${group} chunk`, [`assets/ holds ${chunks.length}`], '');
        continue;
      }
      const others = staticImports(scripts.get(chunks[0]) ?? '').filter((name) => !allowed.some((prefix) => name.startsWith(prefix)));
      rule(`the ${group} chunk imports only ${allowed.map((prefix) => `${prefix}*`).join(' and ')}`, others.map((name) => `it imports ${name}`), chunks[0]);
    }
  }
}

/** The distinct origins of the Supabase values of a remote build. A missing or broken value gives none. */
export function originsOf(env: Record<string, string | undefined>): string[] {
  const origins = ['VITE_SUPABASE_URL', 'VITE_API_URL'].flatMap((name) => {
    try {
      return env[name] ? [new URL(env[name]!).origin] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(origins)];
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
  // npm run build:remote exports the public values of config/remote.<env>.env before this check, so the origins are known.
  const options: BundleOptions = { firstLoad: { origins: originsOf(process.env), fontsDir: join(root, 'src/design/fonts') } };
  const results = folders.map((folder) => checkBundles(kind, folder, options));
  const ok = results.every((result) => result.ok);
  for (const result of results) for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  console.log(ok ? `Bundle check (${kind}) passed.` : `Bundle check (${kind}) failed.`);
  process.exit(ok ? 0 : 1);
}
