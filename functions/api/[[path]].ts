// Cloudflare Pages Function for every request under /api: the page's own api, handed to the server host of its copy (server/http/pagesApiProxy.ts).
import { proxyApi } from '../../server/http/pagesApiProxy';

export const onRequest = ({ request, env }: { request: Request; env: Record<string, unknown> }): Promise<Response> => proxyApi(request, env);
