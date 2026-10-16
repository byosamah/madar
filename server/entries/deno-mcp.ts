import { requestHost } from '../core/after';
import { startMcp } from './mcp';
import { onSupabase } from './serverHeader';
import { closeOnUnload, lazyStart } from './start';

/** The mcp function on Supabase Edge Functions (Deno). supabase/functions/mcp/index.ts serves this bundle; the path starts with /mcp. */
const mcp = lazyStart('mcp', startMcp);

// The worker closes its database pools before Supabase stops it (closeOnUnload, start.ts).
if (requestHost().host === 'supabase') closeOnUnload(mcp);

export default { fetch: onSupabase(mcp) };
