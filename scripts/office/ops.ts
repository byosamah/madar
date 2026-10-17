import type { OfficeParts } from '../../server/office/parts';

/**
 * The office ops as the scripts call them (Supabase exit, wave 4): POST <base>/api/office/<op>?office=<name> with the secret
 * header. The secret goes only into the header, never into a log line or an error text.
 */
export type OfficeOps = { post<T>(op: string, body: unknown): Promise<T> };

async function answerOf<T>(op: string, response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw new Error(`The office op ${op} answered ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export function opsOf(o: { base: string; secret: string; header: string; office?: string; fetch?: typeof fetch }): OfficeOps {
  const send = o.fetch ?? fetch;
  return {
    async post<T>(op: string, body: unknown): Promise<T> {
      const url = new URL(`/api/office/${op}`, o.base);
      if (o.office) url.searchParams.set('office', o.office);
      const response = await send(url.toString(), { method: 'POST', headers: { 'content-type': 'application/json', [o.header]: o.secret }, body: JSON.stringify(body) });
      return answerOf<T>(op, response);
    },
  };
}

/** For tests: the same ops straight on the office parts of node:sqlite, with no Worker and no secret. */
export function partsOps(parts: Pick<OfficeParts, 'ops'>): OfficeOps {
  return {
    async post<T>(op: string, body: unknown): Promise<T> {
      return answerOf<T>(op, await parts.ops(new Request(`https://office.internal/office/${op}`, { method: 'POST', body: JSON.stringify(body) })));
    },
  };
}
