// Cloudflare Pages Function for every request under /map: the same-origin street map files, read from the R2 bucket of the MAP binding (server/http/pagesMap.ts).
import { serveMap } from '../../server/http/pagesMap';

export const onRequest = ({ request, env }: { request: Request; env: Record<string, unknown> }): Promise<Response> => serveMap(request, env);
