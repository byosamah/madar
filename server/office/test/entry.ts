import { PinOffice } from './pinOffice';

export { PinOffice };

type Namespace = { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };

/** The test Worker of test:office: it hands each request to the office object that the query names (o). */
export default {
  async fetch(request: Request, env: { OFFICE: Namespace }): Promise<Response> {
    const name = new URL(request.url).searchParams.get('o') ?? 'office';
    return env.OFFICE.get(env.OFFICE.idFromName(name)).fetch(request);
  },
};
