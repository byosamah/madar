import { startMcp } from './mcp';
import { lazyStart } from './start';

/** The mcp function on Supabase Edge Functions (Deno). supabase/functions/mcp/index.ts serves this bundle; the path starts with /mcp. */
export default { fetch: lazyStart('mcp', startMcp) };
