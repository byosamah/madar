import { notBuiltResponse } from '../core/notBuilt';

/** The mcp function on Supabase Edge Functions (Deno). */
export default { fetch: async (_request: Request): Promise<Response> => notBuiltResponse('The MCP server') };
