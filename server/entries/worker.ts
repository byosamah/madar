import { setEnvSource } from '../env';
import { startApps } from './apps';
import { lazyStart } from './start';

/**
 * The Cloudflare Workers entry, the fallback host (plan 2b, point 2): /api, /mcp and /jobs from the same source as the Supabase
 * functions, built to dist-server/worker.js and run by wrangler.server.toml. A Worker gets its values with each request, so the
 * entry hands them to env() before the app starts.
 */
const start = lazyStart('worker', () => startApps(['api', 'mcp', 'jobs']));

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    setEnvSource(env);
    return start(request);
  },
};
