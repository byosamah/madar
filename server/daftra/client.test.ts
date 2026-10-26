import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAFTRA_TIMEOUT_MS, DaftraError, daftraAccountsOf, daftraClientOf, daftraOf } from './client';
import { daftraDeps, fakeDaftra } from './fakeDaftra';

const source = readFileSync(new URL('./client.ts', import.meta.url), 'utf8');

function world() {
  const fake = fakeDaftra({
    clients: [{ id: '842', name: 'Al Noor Villa', number: '12' }, { id: '99', name: 'Other Co' }],
    invoices: [
      { id: '1830', no: '1521945', clientId: '842', total: 12_500, date: '2026-10-20', created: '2026-10-21 16:00:00', paymentStatus: 2, payments: [{ date: '2026-10-22 00:00:00', amount: 12_500 }] },
      { id: '1831', no: '1521946', clientId: '842', total: 300, date: '2026-07-01', created: '2026-07-02 08:00:00' },
      { id: '1900', no: '1521999', clientId: '99', total: 50, date: '2026-10-20', created: '2026-10-21 16:00:00' },
    ],
  });
  const client = daftraClientOf({ site: fake.site, apiKey: fake.apiKey, fetch: fake.fetch });
  return { fake, client };
}

describe('GET only (the owner rule: Madar never writes to Daftra)', () => {
  it('the source has one fetch call, one method word (GET), and no request body', () => {
    expect(source.match(/\brun\(/g)).toHaveLength(1);
    expect(source.match(/method:/g)).toHaveLength(1);
    expect(source).toContain("method: 'GET'");
    for (const word of ['POST', 'PUT', 'PATCH', 'DELETE', 'body:', 'FormData']) expect(source, word).not.toContain(word);
  });

  it('every request of every method is a GET with the key in the apikey header', async () => {
    const { fake, client } = world();
    await client.findClients('noor');
    await client.client('842');
    await client.invoicesOf('842', '2026-01-01');
    await client.invoice('1830');
    expect(fake.requests).toHaveLength(4);
    for (const request of fake.requests) {
      expect(request.method).toBe('GET');
      expect(request.apikey).toBe(fake.apiKey);
      expect(request.url.startsWith(`https://${fake.site}/api2/`)).toBe(true);
    }
  });

  it('the client has the four read methods and nothing else', () => {
    const { client } = world();
    expect(Object.keys(client).sort()).toEqual(['client', 'findClients', 'invoice', 'invoicesOf']);
  });

  it('never puts the key in an address', async () => {
    const { fake, client } = world();
    await client.invoice('1830');
    for (const request of fake.requests) expect(request.url).not.toContain(fake.apiKey);
  });
});

describe('the four reads', () => {
  it('findClients sends keywords and limit 10, and returns id, name and number', async () => {
    const { fake, client } = world();
    expect(await client.findClients('noor')).toEqual([{ id: '842', name: 'Al Noor Villa', number: '12' }]);
    expect(fake.paths()).toEqual(['clients.json?keywords=noor&limit=10']);
  });

  it('client reads one client, and a missing one gives not_found', async () => {
    const { client } = world();
    expect(await client.client('842')).toEqual({ id: '842', name: 'Al Noor Villa', number: '12' });
    await expect(client.client('777')).rejects.toMatchObject({ code: 'not_found', status: 404, retryable: false });
  });

  it('invoicesOf sends client_id, created_from and limit 50, and parses the list form', async () => {
    const { fake, client } = world();
    const list = await client.invoicesOf('842', '2026-10-01');
    expect(list.map((i) => i.id)).toEqual(['1830']);
    expect(list[0]).toMatchObject({ totalHalalas: 1_250_000, issuedOn: '2026-10-20', paymentStatus: 2, paidOn: null });
    expect(fake.paths()).toEqual(['invoices.json?client_id=842&created_from=2026-10-01&limit=50']);
  });

  it('invoice parses the single form: the paid day comes from the last payment row', async () => {
    const { client } = world();
    expect(await client.invoice('1830')).toMatchObject({ id: '1830', no: '1521945', clientId: '842', totalHalalas: 1_250_000, paymentStatus: 2, paidOn: '2026-10-22', issuedOn: '2026-10-21' });
  });

  it('refuses an id or a day of the wrong shape before any request', async () => {
    const { fake, client } = world();
    await expect(client.invoice('../clients/1')).rejects.toMatchObject({ code: 'not_found' });
    await expect(client.invoice('12 ')).rejects.toMatchObject({ code: 'not_found' });
    await expect(client.client('1?x=1')).rejects.toMatchObject({ code: 'not_found' });
    await expect(client.invoicesOf('842', 'yesterday')).rejects.toBeInstanceOf(DaftraError);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('errors', () => {
  it('maps the status: 401 bad_key, 403 refused, 429 and 5xx retryable', async () => {
    const { fake, client } = world();
    const cases: [number, string, boolean][] = [[401, 'bad_key', false], [403, 'refused', false], [404, 'not_found', false], [429, 'rate_limited', true], [500, 'server', true], [503, 'server', true]];
    for (const [status, code, retryable] of cases) {
      fake.mode = status;
      await expect(client.invoice('1830')).rejects.toMatchObject({ code, status, retryable });
    }
  });

  it('a wrong key gives bad_key (the fake answers 401)', async () => {
    const { fake } = world();
    const wrong = daftraClientOf({ site: fake.site, apiKey: 'WrongKey0123456789WrongKey0123456789', fetch: fake.fetch });
    await expect(wrong.invoice('1830')).rejects.toMatchObject({ code: 'bad_key', status: 401 });
  });

  it('a network error gives unreachable (retryable) and its text never holds the key or the site', async () => {
    const { fake, client } = world();
    fake.mode = 'network';
    try {
      await client.invoice('1830');
      throw new Error('no refusal');
    } catch (error) {
      expect(error).toMatchObject({ code: 'unreachable', retryable: true, status: 0 });
      const all = `${String(error)} ${(error as Error).message} ${(error as Error).stack}`;
      expect(all).not.toContain(fake.apiKey);
      expect(all).not.toContain(fake.site);
    }
  });

  it('an answer that is no JSON gives bad_answer', async () => {
    const { fake, client } = world();
    fake.mode = 'junk';
    await expect(client.invoice('1830')).rejects.toMatchObject({ code: 'bad_answer', retryable: false });
  });

  it('an answer of the wrong shape gives bad_answer with no text of the answer', async () => {
    const calls = daftraClientOf({ site: 'a.daftra.com', apiKey: 'k'.repeat(24), fetch: async () => Response.json({ result: 'successful', code: 200, data: { Invoice: { id: '1', summary_total: 'SECRET-TEXT' } } }) });
    try {
      await calls.invoice('1');
      throw new Error('no refusal');
    } catch (error) {
      expect(error).toMatchObject({ code: 'bad_answer' });
      expect(String(error)).not.toContain('SECRET-TEXT');
    }
  });

  it('a 200 with a failed result and its own code is an error too', async () => {
    const odd = daftraClientOf({ site: 'a.daftra.com', apiKey: 'k'.repeat(24), fetch: async () => Response.json({ result: 'failed', code: 403, message: 'role' }) });
    await expect(odd.invoice('1')).rejects.toMatchObject({ code: 'refused', status: 403 });
  });

  it('a redirect is a refusal and the key goes nowhere else', async () => {
    const seen: RequestInit[] = [];
    const redirecting = daftraClientOf({
      site: 'a.daftra.com', apiKey: 'k'.repeat(24),
      fetch: async (_url, init) => {
        seen.push(init ?? {});
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
      },
    });
    await expect(redirecting.invoice('1')).rejects.toMatchObject({ code: 'refused', status: 302 });
    expect(seen).toHaveLength(1);
    expect(seen[0].redirect).toBe('manual');
  });

  it('error text of a refusal body never reaches the error (the fake echoes the key in its message)', async () => {
    const { fake, client } = world();
    fake.mode = 500;
    try {
      await client.invoice('1830');
      throw new Error('no refusal');
    } catch (error) {
      expect(`${String(error)} ${(error as Error).message}`).not.toContain(fake.apiKey);
    }
  });
});

describe('the time limit', () => {
  it('is 10 seconds by default (the documented exception to the 3 second rule)', () => {
    expect(DAFTRA_TIMEOUT_MS).toBe(10_000);
  });

  it('a call that never answers ends as timeout, retryable, and aborts the request', async () => {
    const { fake } = world();
    fake.mode = 'timeout';
    const quick = daftraClientOf({ site: fake.site, apiKey: fake.apiKey, fetch: fake.fetch, timeoutMs: 20 });
    await expect(quick.invoice('1830')).rejects.toMatchObject({ code: 'timeout', retryable: true });
  });
});

describe('daftraOf (one client for one account)', () => {
  it('is undefined with no Daftra config, and for an account that the copy has no keys for', () => {
    expect(daftraOf({ config: {} as never }, 'MAZJ')).toBeUndefined();
    const { fake } = world();
    expect(daftraOf(daftraDeps(fake), 'VADO')).toBeUndefined();
    expect(daftraOf(daftraDeps(fake), 'mazj')).toBeUndefined();
  });

  it('makes a client from the config of that account and the injected fetch', async () => {
    const { fake } = world();
    const client = daftraOf(daftraDeps(fake), 'MAZJ');
    expect(await client!.client('842')).toMatchObject({ id: '842' });
    expect(fake.requests[0].apikey).toBe(fake.apiKey);
  });

  it('keeps the accounts apart: each account reads its own site with its own key, never the key of another account', async () => {
    const mazj = fakeDaftra({ account: 'MAZJ', clients: [{ id: '842', name: 'Mazj Client' }] });
    const vado = fakeDaftra({ account: 'VADO', clients: [{ id: '842', name: 'Vado Client' }] });
    expect(mazj.apiKey).not.toBe(vado.apiKey);
    expect(mazj.site).not.toBe(vado.site);
    const deps = daftraDeps(mazj, vado);
    expect(await daftraOf(deps, 'MAZJ')!.client('842')).toMatchObject({ name: 'Mazj Client' });
    expect(await daftraOf(deps, 'VADO')!.client('842')).toMatchObject({ name: 'Vado Client' });
    expect(mazj.requests).toHaveLength(1);
    expect(vado.requests).toHaveLength(1);
    expect(mazj.requests[0].apikey).toBe(mazj.apiKey);
    expect(vado.requests[0].apikey).toBe(vado.apiKey);
  });

  it('lists the account names of the config, sorted, and no key or site', () => {
    const deps = daftraDeps(fakeDaftra({ account: 'VADO' }), fakeDaftra({ account: 'BUNAH' }));
    expect(daftraAccountsOf(deps)).toEqual(['BUNAH', 'VADO']);
    expect(daftraAccountsOf({ config: {} as never })).toEqual([]);
  });
});
