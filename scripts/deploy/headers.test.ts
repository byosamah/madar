import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesOrigin, renderHeaders, supabaseOrigin } from './headers.ts';

/** config/headers.template turned into dist/_headers (plan 5.9; proof Z0a, item 6). pages.sh runs it after the remote build. */
const template = readFileSync(new URL('../../config/headers.template', import.meta.url), 'utf8');
const TEST = 'https://qdgwpnesxppnqsaabqzd.supabase.co';
const PRODUCTION = 'https://oprkvdjudjxxhvodkzgs.supabase.co';
const ACCOUNT = 'd76d34779c63849f5acdf3d6af3751cd';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OPENFREEMAP = 'https://tiles.openfreemap.org';
// PostHog Cloud EU: usage data, errors and masked replays for the owner (insight design, 2026-10-25). It is the only new host.
const POSTHOG = 'https://eu.i.posthog.com';
const POSTHOG_ASSETS = 'https://eu-assets.i.posthog.com';

/** The sources of one CSP directive. */
function directive(headers: string, name: string): string[] {
  const csp = /Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? '';
  const part = csp.split(';').map((piece) => piece.trim()).find((piece) => piece.split(' ')[0] === name);
  return part ? part.split(' ').slice(1) : [];
}

describe('renderHeaders', () => {
  it('keeps the plain security headers and the long cache for the assets', () => {
    const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
    expect(headers).toMatch(/^\/\*\n/);
    expect(headers).toContain('  X-Content-Type-Options: nosniff');
    expect(headers).toContain('  Referrer-Policy: no-referrer');
    expect(headers).toContain('  X-Frame-Options: DENY');
    expect(headers).toMatch(/\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
    expect(directive(headers, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(headers, 'style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    // 'wasm-unsafe-eval' lets the Arabic text plugin of the map run its WebAssembly. It allows no eval() (owner, 2026-10-19).
    expect(directive(headers, 'script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  });

  it('lets the service worker of browser push run from the own site only, and never lets it be cached (owner, 2026-10-08)', () => {
    const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
    expect(headers).toMatch(/\n\/sw\.js\n {2}Cache-Control: no-cache\n/);
    expect(directive(headers, 'worker-src')).toEqual(["'self'"]);
    // The security headers still reach the worker script: the rule of /* applies to /sw.js too.
    expect(headers).toMatch(/^\/\*\n/);
  });

  it('adds no host for the push services: the browser, not the page, talks to them', () => {
    const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
    for (const host of ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']) expect(headers).not.toContain(host);
    expect(directive(headers, 'connect-src').every((source) => source === "'self'" || source === NOMINATIM || source === OPENFREEMAP || source === POSTHOG || source === POSTHOG_ASSETS || source.includes('qdgwpnesxppnqsaabqzd.supabase.co'))).toBe(true);
  });

  it('while the files are on Supabase Storage, names the Supabase host for pictures, the PDF frame and the calls, and no R2 host', () => {
    const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
    expect(directive(headers, 'img-src')).toEqual(["'self'", 'data:', 'blob:', TEST]);
    expect(directive(headers, 'frame-src')).toEqual([TEST]);
    expect(directive(headers, 'connect-src')).toEqual(["'self'", TEST, 'wss://qdgwpnesxppnqsaabqzd.supabase.co', NOMINATIM, OPENFREEMAP, POSTHOG, POSTHOG_ASSETS]);
    expect(headers).not.toContain('r2.cloudflarestorage.com');
  });

  it('lets the page send to PostHog Cloud EU and changes no other directive for it (insight design, section 6)', () => {
    const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
    expect(directive(headers, 'connect-src')).toContain(POSTHOG);
    // The settings file of the project (replays, clicks) comes from the assets host as JSON. Its scripts stay out (script-src below).
    expect(directive(headers, 'connect-src')).toContain(POSTHOG_ASSETS);
    expect(headers).not.toContain('posthog.com/static');
    for (const name of ['script-src', 'worker-src', 'img-src', 'frame-src', 'default-src', 'style-src', 'font-src']) expect(directive(headers, name).join(' '), name).not.toContain('posthog');
  });

  it('names only the hosts of the chosen environment', () => {
    const test = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
    const production = renderHeaders(template, { supabaseUrl: PRODUCTION, store: 'supabase' });
    expect(test).not.toContain('oprkvdjudjxxhvodkzgs');
    expect(production).not.toContain('qdgwpnesxppnqsaabqzd');
    const hosts = (text: string) => [...new Set([...text.matchAll(/(?:https|wss):\/\/[^\s;]+/g)].map((match) => match[0]))];
    expect(hosts(test)).toEqual([TEST, 'wss://qdgwpnesxppnqsaabqzd.supabase.co', NOMINATIM, OPENFREEMAP, POSTHOG, POSTHOG_ASSETS]);
    expect(hosts(production)).toEqual([PRODUCTION, 'wss://oprkvdjudjxxhvodkzgs.supabase.co', NOMINATIM, OPENFREEMAP, POSTHOG, POSTHOG_ASSETS]);
  });

  it('after the move to R2, names the R2 EU host for the files and keeps the Supabase host for the calls', () => {
    const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'r2', r2AccountId: ACCOUNT });
    const r2 = `https://${ACCOUNT}.eu.r2.cloudflarestorage.com`;
    expect(directive(headers, 'img-src')).toEqual(["'self'", 'data:', 'blob:', r2]);
    expect(directive(headers, 'frame-src')).toEqual([r2]);
    expect(directive(headers, 'connect-src')).toEqual(["'self'", TEST, 'wss://qdgwpnesxppnqsaabqzd.supabase.co', r2, NOMINATIM, OPENFREEMAP, POSTHOG, POSTHOG_ASSETS]);
  });

  it('drops the comments of the template and leaves no placeholder', () => {
    const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
    expect(headers).not.toMatch(/^#/m);
    expect(headers).not.toContain('{{');
    for (const line of headers.split('\n')) expect(line.length).toBeLessThanOrEqual(2000);
  });

  it('refuses a template with a placeholder it does not know', () => {
    expect(() => renderHeaders(`${template}\n/x\n  X-Test: {{OTHER}}\n`, { supabaseUrl: TEST, store: 'supabase' })).toThrow(/OTHER/);
  });
});

/** The path of the one map worker file (vite.config.ts, worker.rolldownOptions). The rule of config/headers.template matches it. */
const WORKER_PATH = '/assets/map-worker/*';

/** The CSP directives of one policy text, by name. */
function directivesOf(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(';').map((piece) => piece.trim().split(' ')).filter((parts) => parts[0] !== '').map(([name, ...sources]) => [name, sources]),
  );
}

/** The header rules of a _headers text: a path line, then the indented lines (a set line, or a detach line that starts with "! "). */
function rulesOf(headers: string): { path: string; lines: string[] }[] {
  const rules: { path: string; lines: string[] }[] = [];
  for (const line of headers.split('\n')) {
    if (line.trim() === '') continue;
    if (/^\s/.test(line)) rules.at(-1)?.lines.push(line.trim());
    else rules.push({ path: line.trim(), lines: [] });
  }
  return rules;
}

/**
 * The headers that Cloudflare Pages sends for one path. It follows the documented rule (developers.cloudflare.com/pages/configuration/headers):
 * every rule whose pattern matches applies, in file order. A "! Name" line removes a header that an earlier rule set, then the same rule
 * may set it again. A header set twice joins its values with a comma. The pattern takes one splat (*), which matches every character.
 */
function sentFor(headers: string, path: string): Record<string, string[]> {
  const sent: Record<string, string[]> = {};
  for (const rule of rulesOf(headers)) {
    const pattern = new RegExp(`^${rule.path.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    if (!pattern.test(path)) continue;
    for (const line of rule.lines.filter((l) => l.startsWith('! '))) delete sent[line.slice(2).trim().toLowerCase()];
    for (const line of rule.lines.filter((l) => !l.startsWith('! '))) {
      const at = line.indexOf(': ');
      const key = line.slice(0, at).toLowerCase();
      (sent[key] ??= []).push(line.slice(at + 2));
    }
  }
  return sent;
}

describe('the policy of the map worker (owner decision A, 2026-10-28, tsk_486)', () => {
  const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
  const page = directivesOf(/Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? '');

  it('gives the one map worker path its own rule after the rule of every page: a detach line, then its own policy', () => {
    const rules = rulesOf(headers);
    const at = rules.findIndex((rule) => rule.path === WORKER_PATH);
    expect(at).toBeGreaterThan(0);
    expect(rules[0].path).toBe('/*');
    expect(rules[at].lines).toHaveLength(2);
    expect(rules[at].lines[0]).toBe('! Content-Security-Policy');
    expect(rules[at].lines[1]).toMatch(/^Content-Security-Policy: /);
  });

  it('adds \'unsafe-eval\' to script-src of the worker policy and changes no other directive', () => {
    const worker = directivesOf(sentFor(headers, '/assets/map-worker/maplibre-gl-worker-abc123.js')['content-security-policy'][0]);
    expect(worker['script-src']).toEqual([...page['script-src'], "'unsafe-eval'"]);
    const { 'script-src': _worker, ...otherWorker } = worker;
    const { 'script-src': _page, ...otherPage } = page;
    expect(otherWorker).toEqual(otherPage);
    // The worker fetches the tiles and the glyphs of OpenFreeMap, and the Arabic text plugin file of the own site.
    expect(worker['connect-src']).toContain(OPENFREEMAP);
    expect(worker['connect-src']).toContain("'self'");
  });

  it('keeps the page policy as it is: no eval anywhere in the policy of a page, a script or a style', () => {
    expect(page['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    for (const path of ['/', '/index.html', '/projects/prj_1', '/assets/index-abc.js', '/assets/maplibre-gl-abc.js', '/assets/maplibre-gl-worker-abc.js', '/sw.js']) {
      const csp = sentFor(headers, path)['content-security-policy'];
      expect(csp, path).toHaveLength(1);
      expect(csp[0], path).not.toContain("'unsafe-eval'");
      expect(directivesOf(csp[0]), path).toEqual(page);
    }
  });

  it('sends exactly one policy to the worker file, because two policies are both enforced', () => {
    const sent = sentFor(headers, '/assets/map-worker/maplibre-gl-worker-abc123.js');
    expect(sent['content-security-policy']).toHaveLength(1);
    expect(sent['content-security-policy'][0]).toContain("'unsafe-eval'");
    // The long cache and the plain security headers still reach the worker.
    expect(sent['cache-control']).toEqual(['public, max-age=31536000, immutable']);
    expect(sent['x-content-type-options']).toEqual(['nosniff']);
  });

  it("holds 'unsafe-eval' once in the whole file, in the policy of the worker path", () => {
    expect(headers.split("'unsafe-eval'")).toHaveLength(2);
  });
});

describe('supabaseOrigin and filesOrigin', () => {
  it('take only the https origin of a hosted project, never a local or other host', () => {
    expect(supabaseOrigin(`${TEST}/`)).toBe(TEST);
    expect(() => supabaseOrigin('http://127.0.0.1:54321')).toThrow(/supabase\.co/);
    expect(() => supabaseOrigin('https://example.com')).toThrow(/supabase\.co/);
    expect(() => supabaseOrigin(`${TEST}/functions/v1/api`)).toThrow(/supabase\.co/);
  });

  it('needs the Cloudflare account for R2, and knows only the two stores', () => {
    expect(() => filesOrigin({ supabaseUrl: TEST, store: 'r2' })).toThrow(/R2_ACCOUNT_ID/);
    expect(() => filesOrigin({ supabaseUrl: TEST, store: 'r2', r2AccountId: 'not-an-id' })).toThrow(/R2_ACCOUNT_ID/);
    expect(() => filesOrigin({ supabaseUrl: TEST, store: 's3' as 'r2' })).toThrow(/MADAR_FILE_STORE/);
  });
});
