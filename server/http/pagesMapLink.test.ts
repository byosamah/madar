import { describe, expect, it, vi } from 'vitest';
import { followShortLink, resolveMapLink } from './pagesMapLink';

/** A fake fetch. Each address answers a redirect to the next address, or a plain 200. */
function fakeFetch(chain: Record<string, string | number>) {
  const calls: string[] = [];
  const run = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const next = chain[url];
    if (typeof next === 'string') return new Response(null, { status: 302, headers: { location: next } });
    return new Response('page', { status: typeof next === 'number' ? next : 404 });
  });
  return { run: run as unknown as typeof fetch, calls };
}

const SHORT = 'https://maps.app.goo.gl/AbC123';
const LONG = 'https://www.google.com/maps/place/Corniche/@26.2834,50.2105,17z/data=!3d26.2834!4d50.2105';

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://madar.example/maplink', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
}

describe('followShortLink (PRJ-03)', () => {
  it('follows the redirect of a short link and stops at the Google Maps address, without opening it', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: LONG });
    expect(await followShortLink(SHORT, run)).toBe(LONG);
    expect(calls).toEqual([SHORT]);
  });

  it('follows more than one redirect, and reads the address inside a consent page', async () => {
    const consent = `https://consent.google.com/m?continue=${encodeURIComponent(LONG)}&gl=NL`;
    const { run } = fakeFetch({ [SHORT]: 'https://goo.gl/maps/Zz9', 'https://goo.gl/maps/Zz9': consent });
    expect(await followShortLink(SHORT, run)).toBe(LONG);
  });

  it('refuses a redirect to a host outside the Google list, and never calls it', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: 'https://evil.example/steal' });
    expect(await followShortLink(SHORT, run)).toBeNull();
    expect(calls).toEqual([SHORT]);
  });

  it('gives null after four redirects without an end, or when the link answers with no redirect', async () => {
    const loop = fakeFetch({ [SHORT]: 'https://goo.gl/maps/a', 'https://goo.gl/maps/a': 'https://goo.gl/maps/b', 'https://goo.gl/maps/b': 'https://goo.gl/maps/c', 'https://goo.gl/maps/c': 'https://goo.gl/maps/d', 'https://goo.gl/maps/d': 'https://goo.gl/maps/e' });
    expect(await followShortLink(SHORT, loop.run)).toBeNull();
    expect(await followShortLink(SHORT, fakeFetch({ [SHORT]: 200 }).run)).toBeNull();
  });

  it('gives null when the request fails', async () => {
    const run = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    expect(await followShortLink(SHORT, run)).toBeNull();
  });
});

describe('resolveMapLink (PRJ-03)', () => {
  it('answers the long address of a short link, and never keeps the answer', async () => {
    const { run } = fakeFetch({ [SHORT]: LONG });
    const response = await resolveMapLink(post({ url: SHORT }, { 'sec-fetch-site': 'same-origin' }), run);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: LONG });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('accepts the old goo.gl/maps form', async () => {
    const { run } = fakeFetch({ 'https://goo.gl/maps/Zz9': LONG });
    expect((await resolveMapLink(post({ url: 'https://goo.gl/maps/Zz9' }), run)).status).toBe(200);
  });

  it('refuses any address that is not a short Google Maps link, and calls nothing', async () => {
    const { run, calls } = fakeFetch({});
    for (const url of ['https://evil.example/x', 'http://maps.app.goo.gl/AbC', 'https://maps.app.goo.gl.evil.example/AbC', 'https://goo.gl/other/Zz9', 'file:///etc/passwd', 'not a url', 42]) {
      const response = await resolveMapLink(post({ url }), run);
      expect(response.status, String(url)).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('answers only POST, and refuses a request from another site', async () => {
    const { run, calls } = fakeFetch({ [SHORT]: LONG });
    expect((await resolveMapLink(new Request('https://madar.example/maplink'), run)).status).toBe(405);
    expect((await resolveMapLink(post({ url: SHORT }, { 'sec-fetch-site': 'cross-site' }), run)).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('answers 502 when the link cannot be followed', async () => {
    const { run } = fakeFetch({ [SHORT]: 200 });
    const response = await resolveMapLink(post({ url: SHORT }), run);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'unreachable' });
  });

  it('refuses a body that is not JSON', async () => {
    const { run } = fakeFetch({});
    const bad = new Request('https://madar.example/maplink', { method: 'POST', body: 'x{' });
    expect((await resolveMapLink(bad, run)).status).toBe(400);
  });
});
