// Cloudflare Pages Function for POST /api/batch: the same-host batch address (server/http/pagesApiProxy.ts).
import { proxyBatch } from '../../server/http/pagesApiProxy';

export const onRequest = ({ request }: { request: Request }): Promise<Response> => proxyBatch(request);
