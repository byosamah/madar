import { notBuiltResponse } from '../core/notBuilt';
import { setEnvSource } from '../env';

/**
 * The Cloudflare Workers entry, the fallback host (plan 2b, point 2): it mounts /api, /mcp and /jobs from the same source as the
 * Supabase functions, and builds to dist-server/worker.js. Track E4 replaces this stub. A Worker gets its values with each request,
 * so the entry hands them to env().
 */
export default {
  async fetch(_request: Request, env: Record<string, unknown>): Promise<Response> {
    setEnvSource(env);
    return notBuiltResponse('The Workers entry');
  },
};
