import { describe, expect, it } from 'vitest';
import { apiOf, curlConfig, orderOf, parseLines, quantile, stepsOf, summary } from './server-time.ts';

/** scripts/proof/server-time.ts (owner, 2026-10-16): the plan of each round, the curl config and the summary. No network. */
const VALUES = { publishableKey: 'sb_publishable_x', token: 'token-value-1', jobsSecret: 'jobs-secret-value-1', build: '2026.10.16' };

describe('the plan of a round', () => {
  it('asks the Supabase function with the region parameter, and the page api without it', () => {
    expect(apiOf('supabase').batch).toBe('https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/api/batch?forceFunctionRegion=eu-central-1');
    expect(apiOf('page')).toEqual({ batch: 'https://preview.madar-46r.pages.dev/api/batch', health: 'https://preview.madar-46r.pages.dev/api/health' });
  });

  it('measures the preflight on the Supabase path only: the page api is the same address', () => {
    expect(stepsOf('supabase', VALUES).map((s) => [s.label, s.method, s.measured])).toEqual([
      ['warm', 'OPTIONS', false], ['preflight', 'OPTIONS', true], ['anon', 'POST', true], ['member', 'POST', true], ['health', 'GET', true],
    ]);
    expect(stepsOf('page', VALUES).map((s) => [s.label, s.method, s.measured])).toEqual([
      ['warm', 'GET', false], ['anon', 'POST', true], ['member', 'POST', true], ['health', 'GET', true],
    ]);
  });

  it('sends the token only with the member call and the jobs secret only with the health call', () => {
    const steps = stepsOf('page', VALUES);
    expect(steps.filter((s) => s.headers.some((h) => h.includes('token-value-1'))).map((s) => s.label)).toEqual(['member']);
    expect(steps.filter((s) => s.headers.some((h) => h.includes('jobs-secret-value-1'))).map((s) => s.label)).toEqual(['health']);
    expect(steps.find((s) => s.label === 'anon')?.headers).toContain('X-Madar-Build: 2026.10.16');
  });

  it('alternates which path goes first', () => {
    expect([0, 1, 2, 3].map(orderOf)).toEqual([['supabase', 'page'], ['page', 'supabase'], ['supabase', 'page'], ['page', 'supabase']]);
  });
});

describe('the curl config', () => {
  it('puts every transfer in one config joined by next, so curl keeps one connection, and quotes each value', () => {
    const text = curlConfig(stepsOf('supabase', { ...VALUES, token: 'tok"en\\1' }));
    expect(text.startsWith('silent\nshow-error\n')).toBe(true);
    expect(text.match(/^next$/gm)).toHaveLength(4);
    expect(text).toContain('header = "Authorization: Bearer tok\\"en\\\\1"');
    expect(text).toContain('data = "{\\"v\\":1,\\"calls\\":[{\\"i\\":0,\\"name\\":\\"session.get\\",\\"input\\":{}}]}"');
    expect(text).toContain('write-out = "member %{http_code} %{time_starttransfer} %{time_total} %header{x-madar-server}\\n"');
  });
});

describe('the summary', () => {
  it('reads the write-out lines, also without a host header, and skips the rest', () => {
    expect(parseLines('anon 401 0.041 0.042 workers;colo=FRA\nmember 200 0.090 0.091 \ncurl: (28) timeout\n')).toEqual([
      { label: 'anon', code: '401', ttfbMs: 41, totalMs: 42, server: 'workers;colo=FRA' },
      { label: 'member', code: '200', ttfbMs: 90, totalMs: 91, server: '' },
    ]);
  });

  it('gives the median, p25 and p75 with linear interpolation', () => {
    expect(quantile([40, 10, 30, 20], 0.5)).toBe(25);
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(quantile([10, 20, 30, 40, 50], 0.75)).toBe(40);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it('prints one line for each path and step, with the codes and the host', () => {
    const lines = summary({
      supabase: [{ label: 'anon', code: '401', ttfbMs: 100, totalMs: 101, server: 'supabase' }, { label: 'anon', code: '401', ttfbMs: 120, totalMs: 121, server: 'supabase' }],
      page: [{ label: 'anon', code: '401', ttfbMs: 60, totalMs: 61, server: 'workers;colo=FRA' }],
    });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^supabase\s+anon\s+2\s+401x2\s+110 105 115\s+111 106 116\s+supabase$/);
    expect(lines[2]).toMatch(/^page\s+anon\s+1\s+401x1\s+60 60 60\s+61 61 61\s+workers;colo=FRA$/);
  });
});
