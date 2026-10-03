import { startJobs } from './jobs';
import { lazyStart } from './start';

/** The jobs function on Supabase Edge Functions (Deno). supabase/functions/jobs/index.ts serves this bundle; the path starts with /jobs. */
export default { fetch: lazyStart('jobs', startJobs) };
