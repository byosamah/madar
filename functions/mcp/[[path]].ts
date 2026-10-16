// Cloudflare Pages Function for every request under /mcp: the short MCP address, handed to the server host of its copy (server/http/pagesMcpProxy.ts).
import { proxyMcp } from '../../server/http/pagesMcpProxy';

export const onRequest = ({ request, env }: { request: Request; env: Record<string, unknown> }): Promise<Response> => proxyMcp(request, fetch, env);
