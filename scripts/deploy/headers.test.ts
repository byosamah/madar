import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesOrigin, renderHeaders, supabaseOrigin } from './headers.ts';

/** config/headers.template turned into dist/_headers (plan 5.9; proof Z0a, item 6). pages.sh runs it after the remote build. */
const template = readFileSync(new URL('../../config/headers.template', import.meta.url), 'utf8');
const TEST = 'https://qdgwpnesxppnqsaabqzd.supabase.co';
const PRODUCTION = 'https://oprkvdjudjxxhvodkzgs.supabase.co';
const ACCOUNT = 'd76d34779c63849f5acdf3d6af3751cd';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

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
    expect(directive(headers, 'script-src')).toEqual(["'self'"]);
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
    expect(directive(headers, 'connect-src').every((source) => source === "'self'" || source === NOMINATIM || source.includes('qdgwpnesxppnqsaabqzd.supabase.co'))).toBe(true);
  });

  it('while the files are on Supabase Storage, names the Supabase host for pictures, the PDF frame and the calls, and no R2 host', () => {
    const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
    expect(directive(headers, 'img-src')).toEqual(["'self'", 'data:', 'blob:', TEST]);
    expect(directive(headers, 'frame-src')).toEqual([TEST]);
    expect(directive(headers, 'connect-src')).toEqual(["'self'", TEST, 'wss://qdgwpnesxppnqsaabqzd.supabase.co', NOMINATIM]);
    expect(headers).not.toContain('r2.cloudflarestorage.com');
  });

  it('names only the hosts of the chosen environment', () => {
    const test = renderHeaders(template, { supabaseUrl: TEST, store: 'supabase' });
    const production = renderHeaders(template, { supabaseUrl: PRODUCTION, store: 'supabase' });
    expect(test).not.toContain('oprkvdjudjxxhvodkzgs');
    expect(production).not.toContain('qdgwpnesxppnqsaabqzd');
    const hosts = (text: string) => [...new Set([...text.matchAll(/(?:https|wss):\/\/[^\s;]+/g)].map((match) => match[0]))];
    expect(hosts(test)).toEqual([TEST, 'wss://qdgwpnesxppnqsaabqzd.supabase.co', NOMINATIM]);
    expect(hosts(production)).toEqual([PRODUCTION, 'wss://oprkvdjudjxxhvodkzgs.supabase.co', NOMINATIM]);
  });

  it('after the move to R2, names the R2 EU host for the files and keeps the Supabase host for the calls', () => {
    const headers = renderHeaders(template, { supabaseUrl: TEST, store: 'r2', r2AccountId: ACCOUNT });
    const r2 = `https://${ACCOUNT}.eu.r2.cloudflarestorage.com`;
    expect(directive(headers, 'img-src')).toEqual(["'self'", 'data:', 'blob:', r2]);
    expect(directive(headers, 'frame-src')).toEqual([r2]);
    expect(directive(headers, 'connect-src')).toEqual(["'self'", TEST, 'wss://qdgwpnesxppnqsaabqzd.supabase.co', r2, NOMINATIM]);
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
