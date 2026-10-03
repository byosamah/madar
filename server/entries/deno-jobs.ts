import { notBuiltResponse } from '../core/notBuilt';

/** The jobs function on Supabase Edge Functions (Deno). */
export default { fetch: async (_request: Request): Promise<Response> => notBuiltResponse('The job runner') };
