import { describe, expect, it } from 'vitest';
import { batchApiUrl, isWebKit } from './pageApi';

/** User agents as the browsers send them. Every browser on an iPhone or iPad is WebKit, whatever its name. */
const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.2592.88 Version/17.0 Mobile/15E148 Safari/604.1',
  ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macEdge: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  jsdom: 'Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0',
};

describe('isWebKit (performance audit DF-12, LV-6)', () => {
  it('is true for Safari on a Mac and for every browser on an iPhone or iPad', () => {
    for (const name of ['iphoneSafari', 'iphoneChrome', 'iphoneFirefox', 'iphoneEdge', 'ipadSafari', 'ipadDesktopMode', 'macSafari'] as const) {
      expect([name, isWebKit(UA[name])]).toEqual([name, true]);
    }
  });

  it('is false for Chrome, Edge and Firefox on a computer, for Chrome on Android, and for the test runner', () => {
    for (const name of ['macChrome', 'macEdge', 'macFirefox', 'androidChrome', 'windowsChrome', 'jsdom'] as const) {
      expect([name, isWebKit(UA[name])]).toEqual([name, false]);
    }
    expect(isWebKit('')).toBe(false);
  });
});

describe('batchApiUrl (performance audit DF-12, LV-6)', () => {
  const direct = 'https://ref.supabase.co/functions/v1/api';
  const base = { apiUrl: direct, pageHosts: 'preview.madar-46r.pages.dev', hostname: 'preview.madar-46r.pages.dev' };

  it('uses the page api on WebKit, so the call needs no CORS preflight', () => {
    expect(batchApiUrl({ ...base, userAgent: UA.iphoneSafari })).toBe('/api');
    expect(batchApiUrl({ ...base, userAgent: UA.iphoneChrome })).toBe('/api');
    expect(batchApiUrl({ ...base, userAgent: UA.macSafari })).toBe('/api');
  });

  it('keeps the direct address on every other browser', () => {
    expect(batchApiUrl({ ...base, userAgent: UA.macChrome })).toBe(direct);
    expect(batchApiUrl({ ...base, userAgent: UA.androidChrome })).toBe(direct);
    expect(batchApiUrl({ ...base, userAgent: UA.macFirefox })).toBe(direct);
  });

  it('keeps the direct address when the build names no page host, or the page is on another host', () => {
    expect(batchApiUrl({ ...base, pageHosts: undefined, userAgent: UA.iphoneSafari })).toBe(direct);
    expect(batchApiUrl({ ...base, pageHosts: '', userAgent: UA.iphoneSafari })).toBe(direct);
    // A deployment hash host has no /api function: the forwarder answers 404 there.
    expect(batchApiUrl({ ...base, hostname: 'a1b2c3.madar-46r.pages.dev', userAgent: UA.iphoneSafari })).toBe(direct);
    expect(batchApiUrl({ ...base, hostname: 'localhost', userAgent: UA.iphoneSafari })).toBe(direct);
  });

  it('reads a list of page hosts, and ignores the case and the spaces', () => {
    const pageHosts = 'madar.vado.sa, www.madar.vado.sa,madar-46r.pages.dev';
    expect(batchApiUrl({ apiUrl: direct, pageHosts, hostname: 'www.madar.vado.sa', userAgent: UA.iphoneSafari })).toBe('/api');
    expect(batchApiUrl({ apiUrl: direct, pageHosts, hostname: 'Madar.Vado.SA', userAgent: UA.iphoneSafari })).toBe('/api');
    expect(batchApiUrl({ apiUrl: direct, pageHosts, hostname: 'preview.madar-46r.pages.dev', userAgent: UA.iphoneSafari })).toBe(direct);
  });

  it('changes nothing for an address that is not a Supabase function: the page api itself, or a local stack', () => {
    expect(batchApiUrl({ ...base, apiUrl: '/api', userAgent: UA.iphoneSafari })).toBe('/api');
    expect(batchApiUrl({ ...base, apiUrl: 'http://127.0.0.1:54321/functions/v1/api', userAgent: UA.iphoneSafari })).toBe('http://127.0.0.1:54321/functions/v1/api');
    expect(batchApiUrl({ ...base, apiUrl: 'not a url', userAgent: UA.iphoneSafari })).toBe('not a url');
  });
});
