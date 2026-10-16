import { requestHost } from '../core/after';
import { startJobs } from './jobs';
import { onSupabase } from './serverHeader';
import { closeOnUnload, lazyStart } from './start';

/** The jobs function on Supabase Edge Functions (Deno). supabase/functions/jobs/index.ts serves this bundle; the path starts with /jobs. */
const jobs = lazyStart('jobs', startJobs);

// The worker closes its database pools before Supabase stops it (closeOnUnload, start.ts).
if (requestHost().host === 'supabase') closeOnUnload(jobs);

export default { fetch: onSupabase(jobs) };
