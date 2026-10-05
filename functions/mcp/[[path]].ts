// Cloudflare Pages Function for every request under /mcp: the short MCP address (server/http/pagesMcpProxy.ts).
import { proxyMcp } from '../../server/http/pagesMcpProxy';

export const onRequest = ({ request }: { request: Request }): Promise<Response> => proxyMcp(request);
