import { FUNCTION_REGION } from './wire';

/**
 * Adds the region parameter to a Supabase function URL, so the function runs in Frankfurt (plan, change 5). Every other address
 * stays as it is (owner, 2026-10-16): the page's own /api of the Worker host, which a Pages Function hands to the Worker, and the
 * local stack. A relative address stays relative: fetch resolves it against the page (location.origin).
 * This file stays small, so the consent screen and the sign-in port can use it without the batch client.
 */
export function regionUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.hostname.endsWith('.supabase.co')) return url;
  if (!parsed.searchParams.has('forceFunctionRegion')) parsed.searchParams.set('forceFunctionRegion', FUNCTION_REGION);
  return parsed.toString();
}
