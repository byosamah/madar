import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DaftraError, daftraClientOf } from './client';
import { DAFTRA_READ_ONLY, readOnlyFetch } from './readOnly';

/**
 * The owner rule (2026-10-26): Madar only reads Daftra, and Madar itself holds that limit. A Daftra key role ("Only Allow") picks the record
 * types a key reaches, but it does not stop a change, so this guard is the lock. It sits at the one door where a request leaves for Daftra.
 */
describe('the read-only guard of the Daftra door', () => {
  it('is on', () => {
    expect(DAFTRA_READ_ONLY).toBe(true);
  });

  it('lets a GET with no body through, also with no method named (fetch reads that as a GET)', async () => {
    const run = vi.fn(async () => new Response('{}'));
    const guarded = readOnlyFetch(run);
    await guarded('https://mazj.daftra.com/api2/invoices.json', { method: 'GET' });
    await guarded('https://mazj.daftra.com/api2/invoices.json', { method: 'get' });
    await guarded('https://mazj.daftra.com/api2/invoices.json');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('refuses every other method and never lets the request leave', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'post']) {
      const run = vi.fn(async () => new Response('{}'));
      await expect(readOnlyFetch(run)('https://mazj.daftra.com/api2/invoices.json', { method }), method).rejects.toMatchObject({ code: 'read_only' });
      expect(run, method).not.toHaveBeenCalled();
    }
  });

  it('refuses a GET that carries a body, and a Request object whose method is not GET', async () => {
    const run = vi.fn(async () => new Response('{}'));
    await expect(readOnlyFetch(run)('https://mazj.daftra.com/api2/invoices.json', { method: 'GET', body: '{}' })).rejects.toMatchObject({ code: 'read_only' });
    const request = new Request('https://mazj.daftra.com/api2/invoices.json', { method: 'DELETE' });
    await expect(readOnlyFetch(run)(request)).rejects.toMatchObject({ code: 'read_only' });
    expect(run).not.toHaveBeenCalled();
  });

  it('a refusal is a DaftraError that is not retryable and names no address, key or site', async () => {
    const error = await readOnlyFetch(vi.fn())('https://mazj.daftra.com/api2/clients.json', { method: 'POST' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DaftraError);
    expect(error).toMatchObject({ code: 'read_only', retryable: false, message: 'read_only' });
  });

  it('the client goes through the guard: a fetch that is handed to the client sees only GETs', async () => {
    const seen: string[] = [];
    const run = async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.method ?? 'GET');
      return new Response(JSON.stringify({ result: 'successful', code: 200, data: [], pagination: {} }));
    };
    const client = daftraClientOf({ site: 'mazj.daftra.com', apiKey: 'k'.repeat(40), fetch: run as typeof fetch });
    await client.findClients('noor');
    expect(seen).toEqual(['GET']);
    const source = readFileSync(new URL('./client.ts', import.meta.url), 'utf8');
    expect(source).toContain('readOnlyFetch(settings.fetch ?? globalThis.fetch)');
  });

  it('no other server file sends a request to the Daftra API: client.ts is the one door', () => {
    const root = new URL('..', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== 'fixtures' && name !== 'node_modules') walk(path); continue; }
        if (path.endsWith('.ts') && !path.endsWith('.test.ts')) files.push(path);
      }
    };
    walk(root);
    const doors = files.filter((path) => readFileSync(path, 'utf8').includes('/api2/') && !path.endsWith('fakeDaftra.ts'));
    expect(doors.map((path) => path.slice(root.length))).toEqual(['daftra/client.ts']);
  });
});
