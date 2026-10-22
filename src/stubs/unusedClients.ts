/**
 * Empty stand-ins for three Supabase client packages that the real screens never call (performance audit 2026-10-21, FL-5):
 * @supabase/storage-js, @supabase/postgrest-js and @supabase/functions-js. The screens use only the sign-in (`auth`), Realtime
 * (`channel`, `removeChannel`, `realtime.setAuth`) of supabase-js. The remote build points those three package names here
 * (`resolve.alias` in vite.config.ts), which keeps about 12 KB gz and 47 KB raw out of the supabase chunk. supabase-js builds
 * one object of each kind in its constructor and exports the error classes, so the stand-ins hold the same names.
 * The source scan in `unusedClients.test.ts` fails when a screen starts to use `.from(`, `.rpc(`, `.storage` or `.functions` of the
 * client, and when a supabase-js upgrade imports a name that is missing here.
 */
export class PostgrestClient {
  constructor(..._args: unknown[]) {}
}
export class PostgrestError extends Error {}
export class StorageClient {
  constructor(..._args: unknown[]) {}
}
export class StorageApiError extends Error {}
export class FunctionsClient {
  constructor(..._args: unknown[]) {}
}
export class FunctionsError extends Error {}
export class FunctionsFetchError extends Error {}
export class FunctionsHttpError extends Error {}
export class FunctionsRelayError extends Error {}
export const FunctionRegion = {};
