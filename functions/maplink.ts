// Cloudflare Pages Function for /maplink: it follows a short Google Maps link and answers the long address (server/http/pagesMapLink.ts).
import { resolveMapLink } from '../server/http/pagesMapLink';

export const onRequest = ({ request }: { request: Request }): Promise<Response> => resolveMapLink(request);
