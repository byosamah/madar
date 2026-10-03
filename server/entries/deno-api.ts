import { Hono } from 'hono';
import { env, requireEnv } from '../env';
import { checkHealth, pgHealthClient } from '../http/health';

/** The api function on Supabase Edge Functions (Deno). supabase/functions/api/index.ts serves this bundle. The path starts with the function name. */
const app = new Hono().basePath('/api');

app.get('/health', async (c) => {
  const result = await checkHealth({ connect: pgHealthClient(requireEnv('DATABASE_URL'), env('DATABASE_CA')), region: env('SB_REGION') ?? 'unknown', log: { info: console.log, warn: console.warn, error: (m, f) => console.error(m, JSON.stringify(f)) } });
  return c.json(result.body, result.status as 200 | 503);
});

export default { fetch: app.fetch };
