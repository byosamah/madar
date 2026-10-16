import { startMcp } from './mcp';
import { onSupabase } from './serverHeader';
import { lazyStart } from './start';

/** The mcp function on Supabase Edge Functions (Deno). supabase/functions/mcp/index.ts serves this bundle; the path starts with /mcp. */
export default { fetch: onSupabase(lazyStart('mcp', startMcp)) };
