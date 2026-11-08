// Cloudflare Pages Function of the project madar-platform for every request under /api/platform: handed to the Worker of its copy (server/http/pagesPlatformProxy.ts).
import { proxyPlatform } from '../../../server/http/pagesPlatformProxy';

export const onRequest = ({ request, env }: { request: Request; env: Record<string, unknown> }): Promise<Response> => proxyPlatform(request, env);
