import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveShortLink, shortLinkIn } from './shortLink';

describe('shortLinkIn (PRJ-03)', () => {
  it('finds the short link inside a WhatsApp share, with the place name before it', () => {
    expect(shortLinkIn('Villa Rakah\nhttps://maps.app.goo.gl/AbC123?g_st=iw')).toBe('https://maps.app.goo.gl/AbC123?g_st=iw');
  });

  it('makes an https address of an http one or of one with no scheme', () => {
    expect(shortLinkIn('http://maps.app.goo.gl/AbC123')).toBe('https://maps.app.goo.gl/AbC123');
    expect(shortLinkIn('goo.gl/maps/Zz9')).toBe('https://goo.gl/maps/Zz9');
  });

  it('gives null for a long address or plain text', () => {
    expect(shortLinkIn('https://www.google.com/maps/@26.28,50.21,17z')).toBeNull();
    expect(shortLinkIn('Al Khobar')).toBeNull();
  });
});

describe('resolveShortLink (PRJ-03)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the own address /maplink and gives the long address', async () => {
    const run = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: 'https://www.google.com/maps/@26.28,50.21,17z' }), { status: 200 }));
    vi.stubGlobal('fetch', run);
    expect(await resolveShortLink('https://maps.app.goo.gl/AbC123')).toBe('https://www.google.com/maps/@26.28,50.21,17z');
    expect(run).toHaveBeenCalledWith('/maplink', expect.objectContaining({ method: 'POST', body: JSON.stringify({ url: 'https://maps.app.goo.gl/AbC123' }) }));
  });

  it('gives null when the server says no, the answer is odd, or the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 502 })));
    expect(await resolveShortLink('https://maps.app.goo.gl/AbC123')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: 5 }), { status: 200 })));
    expect(await resolveShortLink('https://maps.app.goo.gl/AbC123')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await resolveShortLink('https://maps.app.goo.gl/AbC123')).toBeNull();
  });
});
