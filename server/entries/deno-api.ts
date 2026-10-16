import { requestHost } from '../core/after';
import { startApi } from './api';
import { onSupabase } from './serverHeader';
import { closeOnUnload, lazyStart } from './start';

/** The api function on Supabase Edge Functions (Deno). supabase/functions/api/index.ts serves this bundle; the path starts with /api. */
const api = lazyStart('api', startApi);

// A new worker on Supabase starts the app, the key set load and the read connection at once, so they overlap with the body of
// its first request (performance audit LIV-7). A test or a script has no Supabase host, so nothing starts at import there.
// The worker closes its database pools before Supabase stops it (closeOnUnload, start.ts).
if (requestHost().host === 'supabase') {
  api.warm();
  closeOnUnload(api);
}

// Every answer names its host (x-madar-server: supabase), also a 404 and a 503.
export default { fetch: onSupabase(api) };
