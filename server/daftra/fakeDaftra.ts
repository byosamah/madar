import type { Deps } from '../core/ports';

/**
 * A stand-in for one Daftra account (the Daftra link, 2026-10-26; one account for each sub-company, so a test makes one fake for each
 * account, and `daftraDeps(a, b)` routes each request to the account of its host). A test passes `fake.fetch` as `Deps.daftraFetch`, so no test reaches
 * Daftra. It answers the four GET reads of `client.ts` in the two forms of the real API: the list gives strings and ISO dates, the
 * single invoice gives numbers and the date form of the account (`DD/MM/YYYY`). It records every request, and it refuses any other
 * method with 405, so a test sees a write at once.
 */

export type FakeInvoice = {
  id: string;
  no: string;
  clientId: string;
  /** The total with VAT in riyals. */
  total: number;
  /** ISO day. */
  date: string;
  /** `YYYY-MM-DD HH:MM:SS`. */
  created: string;
  paymentStatus?: number;
  draft?: boolean;
  /** Payment rows: the `date` is `YYYY-MM-DD HH:MM:SS`. */
  payments?: { date: string; amount: number }[];
};

export type FakeClient = { id: string; name: string; number?: string };

export type FakeDaftraOptions = { account?: string; site?: string; apiKey?: string; clients?: FakeClient[]; invoices?: FakeInvoice[] };

export type FakeDaftra = {
  /** The account name, for example MAZJ. */
  account: string;
  site: string;
  apiKey: string;
  clients: FakeClient[];
  invoices: FakeInvoice[];
  /** Every request: the method, the full address, and the apikey header. */
  requests: { method: string; url: string; apikey: string | null }[];
  /** The GET paths only, like `invoices/1830.json`, with the query. */
  paths(): string[];
  /** What the next requests do: `ok` (default), a status number, `timeout` (never answers), `network` (throws, with the key in its text), `junk` (200 with no JSON). */
  mode: 'ok' | 'timeout' | 'network' | 'junk' | number;
  /** The settings of this account for `Deps.config.daftra[account]`. */
  config: { key: string; site: string };
  fetch: typeof globalThis.fetch;
};

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function fakeDaftra(o: FakeDaftraOptions = {}): FakeDaftra {
  const account = o.account ?? 'MAZJ';
  const fake: FakeDaftra = {
    account,
    site: o.site ?? `${account.toLowerCase()}.daftra.com`,
    apiKey: o.apiKey ?? `MadeUpKey${account}`.padEnd(40, '0123456789'),
    clients: o.clients ?? [],
    invoices: o.invoices ?? [],
    requests: [],
    paths: () => fake.requests.filter((r) => r.method === 'GET').map((r) => r.url.replace(`https://${fake.site}/api2/`, '')),
    mode: 'ok',
    get config() {
      return { key: fake.apiKey, site: fake.site };
    },
    fetch: async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      fake.requests.push({ method, url, apikey: headers.get('apikey') });
      if (method !== 'GET') return new Response('{}', { status: 405 });
      if (fake.mode === 'timeout') {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error(`aborted ${url}`))));
      }
      if (fake.mode === 'network') throw new Error(`connect ECONNREFUSED ${url} apikey ${fake.apiKey}`);
      if (typeof fake.mode === 'number') return new Response(JSON.stringify({ result: 'failed', code: fake.mode, message: `refused ${fake.apiKey}` }), { status: fake.mode });
      if (fake.mode === 'junk') return new Response('<html>not json</html>', { status: 200 });
      if (headers.get('apikey') !== fake.apiKey) return new Response('{}', { status: 401 });
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/^\/api2\//, '');
      const q = parsed.searchParams;
      const ok = (data: unknown) => Response.json({ result: 'successful', code: 200, data });
      if (path === 'clients.json') {
        const words = (q.get('keywords') ?? '').toLowerCase();
        const rows = fake.clients.filter((c) => c.name.toLowerCase().includes(words)).slice(0, Number(q.get('limit') ?? 20));
        return ok(rows.map((c) => ({ Client: { id: c.id, client_number: c.number ?? c.id, business_name: c.name, first_name: '', last_name: '', bn1: '' } })));
      }
      const one = /^clients\/(\d+)\.json$/.exec(path);
      if (one) {
        const c = fake.clients.find((x) => x.id === one[1]);
        return c ? ok({ Client: { id: c.id, client_number: c.number ?? c.id, business_name: c.name, bn1: null } }) : new Response('{}', { status: 404 });
      }
      if (path === 'invoices.json') {
        const from = q.get('created_from') ?? '0000-00-00';
        const rows = fake.invoices.filter((i) => i.clientId === q.get('client_id') && i.created.slice(0, 10) >= from).slice(0, Number(q.get('limit') ?? 20));
        return ok(
          rows.map((i) => ({
            Invoice: {
              id: i.id, type: '0', no: i.no, client_id: i.clientId, currency_code: 'SAR', date: i.date, payment_status: String(i.paymentStatus ?? 0),
              draft: i.draft ? '1' : '0', issued: '1', summary_subtotal: i.total.toFixed(2), summary_total: i.total.toFixed(2),
              summary_paid: '0', summary_unpaid: i.total.toFixed(2), created: i.created, modified: i.created,
            },
          })),
        );
      }
      const single = /^invoices\/(\d+)\.json$/.exec(path);
      if (single) {
        const i = fake.invoices.find((x) => x.id === single[1]);
        if (!i) return new Response('{}', { status: 404 });
        return ok({
          Invoice: {
            id: i.id, type: '0', no: i.no, client_id: i.clientId, currency_code: 'SAR', date: dmy(i.date), payment_status: i.paymentStatus ?? 0,
            draft: i.draft ? '1' : '0', issued: true, summary_subtotal: i.total, summary_total: i.total, summary_paid: String(i.paymentStatus === 2 ? i.total : 0),
            summary_unpaid: i.paymentStatus === 2 ? 0 : i.total, created: i.created, modified: i.created,
            InvoicePayment: (i.payments ?? []).map((p, n) => ({ id: String(n + 1), invoice_id: i.id, amount: String(p.amount), date: p.date, status: '1' })),
            Client: { id: i.clientId, business_name: fake.clients.find((c) => c.id === i.clientId)?.name ?? '', bn1: null },
          },
        });
      }
      return new Response('{}', { status: 404 });
    },
  };
  return fake;
}

/**
 * The two deps of a test that reads Daftra: the config of every fake, by account name, and one fetch that sends each request to the fake whose
 * site is the host of the address. An address of another host gets a network error, so a call to a wrong site shows at once.
 */
export function daftraDeps(...fakes: FakeDaftra[]): Pick<Deps, 'config' | 'daftraFetch'> {
  const config: Record<string, { key: string; site: string }> = {};
  for (const fake of fakes) config[fake.account] = fake.config;
  const route: typeof globalThis.fetch = async (input, init) => {
    const host = new URL(String(input instanceof Request ? input.url : input)).host;
    const fake = fakes.find((candidate) => candidate.site === host);
    if (!fake) throw new Error(`no fake Daftra for ${host}`);
    return fake.fetch(input, init);
  };
  return { config: { daftra: config } as Deps['config'], daftraFetch: route };
}
