import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('the page head (audit 2026-10-03, BRW-20)', () => {
  it('has an inline favicon, so the browser asks for no favicon.ico and logs no 404', () => {
    const html = readFileSync('index.html', 'utf8');
    const icon = html.match(/<link rel="icon" type="image\/svg\+xml" href="(data:image\/svg\+xml,[^"]+)"/);
    expect(icon).not.toBeNull();
    const svg = decodeURIComponent(icon![1].slice('data:image/svg+xml,'.length));
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('prefers-color-scheme:dark');
  });
});
