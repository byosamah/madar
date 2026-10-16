import { startJobs } from './jobs';
import { onSupabase } from './serverHeader';
import { lazyStart } from './start';

/** The jobs function on Supabase Edge Functions (Deno). supabase/functions/jobs/index.ts serves this bundle; the path starts with /jobs. */
export default { fetch: onSupabase(lazyStart('jobs', startJobs)) };
