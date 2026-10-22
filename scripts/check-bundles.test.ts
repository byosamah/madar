import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHART_MARKER, checkBundles, FIRST_LOAD_MAX_BYTES, originsOf, SEED_MARKERS, staticImports, tagsOf, WORD_MARKERS, ZOD_MARKER, type BundleOptions } from './check-bundles.ts';

const dirs: string[] = [];

/** A small dist folder with the given files. */
function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'madar-dist-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const remoteIndex = '<html><head><script type="module" src="/assets/index-abc.js"></script></head></html>';
const prototypeIndex = '<html><head><script type="module" src="./assets/index-abc.js"></script></head></html>';

describe('checkBundles', () => {
  it('passes a clean remote build and prints what it searched', () => {
    const result = checkBundles('remote', dist({ 'index.html': remoteIndex, 'assets/index-abc.js': 'console.log(1)', 'sw.js': 'self.addEventListener("push", () => {})' }));
    expect(result.ok).toBe(true);
    for (const marker of SEED_MARKERS) expect(result.lines.join('\n')).toContain(marker);
    expect(result.lines.join('\n')).toMatch(/3 files/);
  });

  it('fails a remote index.html with a relative ./assets/ path', () => {
    const result = checkBundles('remote', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': '' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('./assets/');
  });

  it('fails a remote build that carries the sample office, even after minification renames buildSeed', () => {
    // Minified: the function names are gone, but the string literals of the seed stay.
    const minified = 'const Te=[{n:"Hala Nasser",a:!0,d:"Architect",g:"female"},{n:"Faisal Al-Harbi",d:"Architect",g:"male"}];function ke(e){return Te.map(e)}';
    const result = checkBundles('remote', dist({ 'index.html': remoteIndex, 'assets/index-x1.js': minified }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('assets/index-x1.js');
  });

  it('searches for text that the sample office really holds', () => {
    const seed = readFileSync(new URL('../src/data/seed.ts', import.meta.url), 'utf8');
    expect(SEED_MARKERS.length).toBeGreaterThan(0);
    for (const marker of SEED_MARKERS) expect(seed).toContain(`'${marker}'`);
  });

  it('passes a clean prototype build and prints what it searched', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': 'buildSeed()' }));
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('supabase');
    expect(result.lines.join('\n')).toContain('_headers');
  });

  it('fails a prototype dist with a _headers file', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, _headers: '/*\n  X-Frame-Options: DENY' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('_headers');
  });

  it('fails a prototype dist that names supabase in any case', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/a.js': 'new SupabaseClient()' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('assets/a.js');
  });

  // The server bundles run on the real office, so they hold no sample office and no settleFuture (cleanup 2026-10-06).
  it('passes a clean server bundle and prints what it searched', () => {
    const result = checkBundles('server', dist({ 'api.js': 'export default app;', 'mcp.js': '', 'jobs.js': '' }));
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('settleFuture');
    for (const marker of SEED_MARKERS) expect(result.lines.join('\n')).toContain(marker);
  });

  it('fails a server bundle that holds the sample office or settleFuture', () => {
    const seed = checkBundles('server', dist({ 'api.js': 'const people = [{ name: "Hala Nasser" }];' }));
    expect(seed.ok).toBe(false);
    expect(seed.lines.join('\n')).toContain('api.js');
    const settle = checkBundles('server', dist({ 'jobs.js': 'function settleFuture(state, at) { return state; }' }));
    expect(settle.ok).toBe(false);
    expect(settle.lines.join('\n')).toContain('jobs.js');
  });

  // The MCP server names its release (owner, 2026-10-12): a client such as claude.ai keeps its tool list for one server version,
  // so a build that did not stamp the version would show the new tools to nobody.
  it('fails a server bundle in which the build did not stamp the server version', () => {
    const raw = checkBundles('server', dist({ 'mcp.js': 'const SERVER_VERSION = typeof __MADAR_SERVER_VERSION__ === "string" ? __MADAR_SERVER_VERSION__ : "1.0.0";' }));
    expect(raw.ok).toBe(false);
    expect(raw.lines.join('\n')).toContain('mcp.js');
    const stamped = checkBundles('server', dist({ 'mcp.js': 'const SERVER_VERSION = "1.0.512";' }));
    expect(stamped.ok).toBe(true);
    expect(stamped.lines.join('\n')).toContain('__MADAR_SERVER_VERSION__');
  });

  it('fails when the folder does not exist, so a missing build never passes', () => {
    const result = checkBundles('prototype', join(tmpdir(), 'madar-no-such-dist'));
    expect(result.ok).toBe(false);
  });
});

/** The font folder of a test: three small files in place of the Thmanyah files. */
function fonts(): string {
  return dist({ 'thmanyahsans-Regular.otf': 'regular', 'thmanyahsans-Medium.otf': 'medium', 'thmanyahsans-Bold.otf': 'bold' });
}

const ORIGIN = 'https://ref.supabase.co';
const link = (rel: string, href: string, extra = '') => `<link rel="${rel}"${extra} crossorigin href="${href}">`;
const FONT_LINKS = ['Regular', 'Medium', 'Bold'].map((weight) => link('preload', `/assets/thmanyahsans-${weight}-x1.otf`, ' as="font" type="font/otf"')).join('\n');

/** The files of a remote build that keeps every first-load rule (performance audit 2026-10-07). */
function goodRemote(): Record<string, string> {
  return {
    'index.html': [
      '<html><head>',
      link('preconnect', ORIGIN),
      '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
      link('modulepreload', '/assets/rolldown-runtime-r1.js'),
      link('modulepreload', '/assets/vendor-v1.js'),
      link('modulepreload', '/assets/bootstrap-b1.js'),
      link('modulepreload', '/assets/supabase-s1.js'),
      FONT_LINKS,
      '<link rel="stylesheet" crossorigin href="/assets/index-c1.css">',
      '</head></html>',
    ].join('\n'),
    'assets/index-abc.js': 'import{a as e}from"./vendor-v1.js";import"./rolldown-runtime-r1.js";const d=()=>import(`./DashboardScreen-d1.js`),w=()=>import(`./words.en-w1.js`);',
    'assets/rolldown-runtime-r1.js': 'var e=Object.create;',
    'assets/vendor-v1.js': 'import"./rolldown-runtime-r1.js";export const a=1;',
    'assets/supabase-s1.js': 'import{a as e}from"./vendor-v1.js";import"./rolldown-runtime-r1.js";export const s=1;',
    'assets/bootstrap-b1.js': 'import{s as e}from"./supabase-s1.js";import{t as n}from"./index-abc.js";export const b=1;',
    // The screens and the words load on demand, so their text is not in the first load.
    'assets/DashboardScreen-d1.js': `const c="${CHART_MARKER}",z="${ZOD_MARKER}";`,
    'assets/words.en-w1.js': `export const en={failed:"${WORD_MARKERS.en}"};`,
    'assets/words.ar-w2.js': `export const ar={failed:"${WORD_MARKERS.ar}"};`,
    'assets/index-c1.css': 'body{}',
    // The service worker of browser push (owner, 2026-10-08): the remote build carries it.
    'sw.js': 'self.addEventListener("push", () => {});',
    'assets/thmanyahsans-Regular-x1.otf': 'regular',
    'assets/thmanyahsans-Medium-x1.otf': 'medium',
    'assets/thmanyahsans-Bold-x1.otf': 'bold',
  };
}

/** The check of a remote build with the first-load rules, with some files changed. */
function checkRemote(change: (files: Record<string, string>) => void = () => undefined, origins = [ORIGIN]) {
  const files = goodRemote();
  change(files);
  const options: BundleOptions = { firstLoad: { origins, fontsDir: fonts() } };
  const result = checkBundles('remote', dist(files), options);
  return { ...result, text: result.lines.join('\n') };
}

const without = (html: string, part: string) => {
  expect(html).toContain(part);
  return html.replace(part, '');
};

describe('the first-load rules of the remote build (performance audit 2026-10-07)', () => {
  it('pass a build that keeps them, and name each rule and its finding', () => {
    const result = checkRemote();
    expect(result.ok, result.text).toBe(true);
    for (const part of [CHART_MARKER, ZOD_MARKER, 'words of a language', `${FIRST_LOAD_MAX_BYTES} B or less`, 'bootstrap-b1.js', 'three Thmanyah files', ORIGIN, 'vendor-v1.js', 'supabase-s1.js']) {
      expect(result.text).toContain(part);
    }
    // index, the runtime, vendor, bootstrap and supabase: the dynamic imports stay out.
    expect(result.text).toMatch(/ok: the first-load scripts stay at .*: 5 files, \d+ B\./);
  });

  it('skip with a line when the caller gives no first-load options', () => {
    const result = checkBundles('remote', dist(goodRemote()));
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('skip: no first-load options given');
  });

  it('fail when a script of the first load holds chart code (BND-1)', () => {
    const result = checkRemote((files) => { files['assets/vendor-v1.js'] += `const c="${CHART_MARKER}";`; });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/FAIL: no chart code .* in the first-load scripts: found in vendor-v1\.js\./);
  });

  it('follow the static imports of a chunk to find chart code that the first load imports (BND-1)', () => {
    const result = checkRemote((files) => {
      files['assets/supabase-s1.js'] = `import"./charts-c1.js";${files['assets/supabase-s1.js']}`;
      files['assets/charts-c1.js'] = `const c="${CHART_MARKER}";`;
    });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/FAIL: no chart code .*: found in charts-c1\.js\./);
  });

  it('fail when the first load passes the size limit (BND-1)', () => {
    const result = checkRemote((files) => { files['assets/vendor-v1.js'] += `/*${'x'.repeat(FIRST_LOAD_MAX_BYTES)}*/`; });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/FAIL: the first-load scripts stay at 1350000 B or less: 5 files hold \d+ B\./);
  });

  it('fail when index.html starts a script that assets/ does not hold (BND-1)', () => {
    const result = checkRemote((files) => { delete files['assets/rolldown-runtime-r1.js']; });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('rolldown-runtime-r1.js is missing');
  });

  it('fail when the first load holds the zod schemas (BND-6)', () => {
    const result = checkRemote((files) => { files['assets/index-abc.js'] += `const z="${ZOD_MARKER}";`; });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/FAIL: no zod schemas .*: found in index-abc\.js\./);
  });

  it('fail when the first load holds the words of either language (BND-7)', () => {
    const en = checkRemote((files) => { files['assets/index-abc.js'] += `const w="${WORD_MARKERS.en}";`; });
    expect(en.ok).toBe(false);
    expect(en.text).toMatch(/FAIL: no words of a language .*: found in index-abc\.js\./);
    const ar = checkRemote((files) => { files['assets/bootstrap-b1.js'] += `const w="${WORD_MARKERS.ar}";`; });
    expect(ar.ok).toBe(false);
    expect(ar.text).toMatch(/FAIL: no words of a language .*: found in bootstrap-b1\.js\./);
  });

  it('fail when index.html does not start the bootstrap chunk, or one of its imports (BND-2)', () => {
    const boot = checkRemote((files) => { files['index.html'] = without(files['index.html'], link('modulepreload', '/assets/bootstrap-b1.js')); });
    expect(boot.ok).toBe(false);
    expect(boot.text).toContain('no modulepreload link to bootstrap-b1.js');
    const supabase = checkRemote((files) => { files['index.html'] = without(files['index.html'], link('modulepreload', '/assets/supabase-s1.js')); });
    expect(supabase.ok).toBe(false);
    expect(supabase.text).toContain('no modulepreload link to supabase-s1.js');
  });

  it('fail when the font links are not the three Thmanyah files with crossorigin and their own bytes (BND-3)', () => {
    const two = checkRemote((files) => { files['index.html'] = without(files['index.html'], link('preload', '/assets/thmanyahsans-Bold-x1.otf', ' as="font" type="font/otf"')); });
    expect(two.ok).toBe(false);
    expect(two.text).toContain('2 font links, not 3');
    expect(two.text).toContain('no link to assets/thmanyahsans-Bold-*.otf');
    const bare = checkRemote((files) => { files['index.html'] = files['index.html'].replace('type="font/otf" crossorigin href="/assets/thmanyahsans-Medium', 'href="/assets/thmanyahsans-Medium'); });
    expect(bare.ok).toBe(false);
    expect(bare.text).toContain('the Medium link has no crossorigin');
    expect(bare.text).toContain('the Medium link has no type font/otf');
    const changed = checkRemote((files) => { files['assets/thmanyahsans-Regular-x1.otf'] = 'a subset'; });
    expect(changed.ok).toBe(false);
    expect(changed.text).toContain('assets/thmanyahsans-Regular-x1.otf differs from thmanyahsans-Regular.otf');
    const gone = checkRemote((files) => { delete files['assets/thmanyahsans-Medium-x1.otf']; });
    expect(gone.ok).toBe(false);
    expect(gone.text).toContain('assets/thmanyahsans-Medium-x1.otf is missing');
  });

  it('fail when index.html does not connect early to each Supabase origin with crossorigin, or connects elsewhere (BND-4)', () => {
    const none = checkRemote((files) => { files['index.html'] = without(files['index.html'], link('preconnect', ORIGIN)); });
    expect(none.ok).toBe(false);
    expect(none.text).toContain(`no preconnect with crossorigin to ${ORIGIN}`);
    const bare = checkRemote((files) => { files['index.html'] = files['index.html'].replace(link('preconnect', ORIGIN), `<link rel="preconnect" href="${ORIGIN}">`); });
    expect(bare.ok).toBe(false);
    expect(bare.text).toContain(`no preconnect with crossorigin to ${ORIGIN}`);
    const other = checkRemote(() => undefined, ['https://other.supabase.co']);
    expect(other.ok).toBe(false);
    expect(other.text).toContain(`a preconnect to ${ORIGIN}`);
    const two = checkRemote(() => undefined, [ORIGIN, 'https://api.example.test']);
    expect(two.ok).toBe(false);
    expect(two.text).toContain('no preconnect with crossorigin to https://api.example.test');
  });

  it('skip the preconnect rule with a line when no origin is known', () => {
    const result = checkRemote(() => undefined, []);
    expect(result.text).toContain('skip: no Supabase origin given');
  });

  it('fail when the vendor or supabase chunk imports an app chunk, or is missing (BND-5)', () => {
    const vendor = checkRemote((files) => { files['assets/vendor-v1.js'] = `import"./index-abc.js";${files['assets/vendor-v1.js']}`; });
    expect(vendor.ok).toBe(false);
    expect(vendor.text).toContain('FAIL: the vendor chunk imports only rolldown-runtime-*: it imports index-abc.js.');
    const supabase = checkRemote((files) => { files['assets/supabase-s1.js'] = `import"./entities-e1.js";${files['assets/supabase-s1.js']}`; files['assets/entities-e1.js'] = ''; });
    expect(supabase.ok).toBe(false);
    expect(supabase.text).toContain('it imports entities-e1.js');
    const gone = checkRemote((files) => { delete files['assets/vendor-v1.js']; });
    expect(gone.ok).toBe(false);
    expect(gone.text).toContain('FAIL: one vendor chunk: assets/ holds 0.');
  });

  it('search for words that the word files really hold (routeError.failed)', () => {
    const en = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as { routeError: { failed: string } };
    const ar = JSON.parse(readFileSync(new URL('../src/i18n/ar.json', import.meta.url), 'utf8')) as { routeError: { failed: string } };
    expect(en.routeError.failed).toBe(WORD_MARKERS.en);
    expect(ar.routeError.failed).toBe(WORD_MARKERS.ar);
  });
});

describe('the push service worker (owner, 2026-10-08)', () => {
  it('fails a prototype dist that holds sw.js: the prototype is one script file and never registers a worker', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': '', 'sw.js': 'self.addEventListener("push", () => {})' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain("'sw.js'");
  });

  it('fails a prototype script that registers the worker', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': 'navigator.serviceWorker.register("/sw.js")' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('/sw.js');
  });

  it('passes a prototype dist with no worker file and no registration', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': 'buildSeed()' }));
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain("'sw.js'");
  });

  it('fails a remote dist with no sw.js: the Settings switch would turn on a worker that is not there', () => {
    const result = checkBundles('remote', dist({ 'index.html': remoteIndex, 'assets/index-abc.js': 'console.log(1)' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('sw.js');
  });
});

describe('the first-load rules of the prototype build', () => {
  it('fail a prototype build with more than one script file, so the artifact holds every script', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': '', 'assets/chunk-x.js': '' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('2 script files');
  });

  it('fail a prototype index.html with a modulepreload, font preload or preconnect link', () => {
    for (const extra of [link('modulepreload', './assets/a.js'), link('preload', './assets/f.otf', ' as="font"'), link('preconnect', 'https://example.test')]) {
      const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex.replace('</head>', `${extra}</head>`), 'assets/index-abc.js': '' }));
      expect(result.ok, extra).toBe(false);
      expect(result.lines.join('\n')).toContain('the prototype index.html starts no early load');
    }
  });
});

describe('the helpers of the bundle check', () => {
  it('read the tags of index.html, with bare and quoted attributes', () => {
    expect(tagsOf('<script type="module" crossorigin src="/assets/a.js"></script><link rel=preload as=\'font\' crossorigin href="/x">')).toEqual([
      { name: 'script', attrs: { type: 'module', crossorigin: true, src: '/assets/a.js' } },
      { name: 'link', attrs: { rel: 'preload', as: 'font', crossorigin: true, href: '/x' } },
    ]);
  });

  it('read the static imports of a minified chunk, and leave the dynamic imports out', () => {
    expect(staticImports('import{a as e,b as $t}from"./a-1.js";import"./b-2.js";export{c}from\'./c-3.js\';import*as d from"./d-4.js";const x=()=>import(`./e-5.js`),y=()=>import("./f-6.js");')).toEqual(['a-1.js', 'b-2.js', 'c-3.js', 'd-4.js']);
  });

  it('give the distinct origins of the Supabase values, and none for a missing or broken value', () => {
    expect(originsOf({ VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_API_URL: 'https://ref.supabase.co/functions/v1/api' })).toEqual(['https://ref.supabase.co']);
    expect(originsOf({ VITE_SUPABASE_URL: 'https://ref.supabase.co/', VITE_API_URL: 'https://api.example.test/api' })).toEqual(['https://ref.supabase.co', 'https://api.example.test']);
    expect(originsOf({ VITE_SUPABASE_URL: 'not a url' })).toEqual([]);
    // The page api of the Worker host (owner, 2026-10-16) is the page itself: no preconnect, the Supabase origin stays for Auth and Realtime.
    expect(originsOf({ VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_API_URL: '/api' })).toEqual(['https://ref.supabase.co']);
    expect(originsOf({})).toEqual([]);
  });
});

describe('the map library (fbk_017): MapLibre loads only at Set pin, never in the prototype', () => {
  it('fails a prototype dist that holds the map library, because the prototype is one script file', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': 'const c="maplibregl-canvas";' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toMatch(/FAIL: the map library \('maplibregl-'\) found in: assets\/index-abc\.js/);
  });

  it('passes a prototype dist with no map library', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': 'const c=1;' }));
    expect(result.ok).toBe(true);
  });

  it('fails a remote first load that holds the map library, so the map would load with the page', () => {
    const result = checkRemote((files) => { files['assets/vendor-v1.js'] += 'const c="maplibregl-ctrl";'; });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/FAIL: no map library \('maplibregl-'\) in the first-load scripts: found in vendor-v1\.js\./);
  });
});

describe('the emoji data (chat presence design D8): the panel loads at its first open, never with the page', () => {
  it('fails a remote first load that holds the emoji data, so the list would load with the page', () => {
    const result = checkRemote((files) => { files['assets/vendor-v1.js'] += 'const c={en:"grinning face"};'; });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/FAIL: no emoji data \('grinning face'\) in the first-load scripts: found in vendor-v1\.js\./);
  });

  it('passes a remote first load with the emoji data in a lazy chunk of its own', () => {
    const result = checkRemote((files) => { files['assets/EmojiPanel-abc.js'] = 'export default {en:"grinning face"};'; });
    expect(result.ok).toBe(true);
  });
});

describe('the drag code (performance audit 2026-10-21, FL-2): the sortable lists load it after the first screen, never with the page', () => {
  it('fails a remote first load that holds dnd-kit, so the drag code would load with the page', () => {
    const result = checkRemote((files) => { files['assets/vendor-v1.js'] += 'const c="DndDescribedBy";'; });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/FAIL: no drag code \('DndDescribedBy'\) in the first-load scripts: found in vendor-v1\.js\./);
  });

  it('passes a remote first load with dnd-kit in a lazy chunk of its own', () => {
    const result = checkRemote((files) => { files['assets/DragLayer-abc.js'] = 'export default "DndDescribedBy";'; });
    expect(result.ok).toBe(true);
  });
});
