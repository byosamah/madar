import { startApi } from './api';
import { lazyStart } from './start';

/** The api function on Supabase Edge Functions (Deno). supabase/functions/api/index.ts serves this bundle; the path starts with /api. */
export default { fetch: lazyStart('api', startApi) };
