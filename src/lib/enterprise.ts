/**
 * The enterprise rules of the screens (Madar enterprises, design 5.16). Pure and safe for the screens and for the server.
 *
 * Screen usage data and screen replays go to the PostHog project of the owner for VADOs' Companies only. A customer has not agreed to
 * usage data. An unknown enterprise (a session that came with no enterprise id) counts as "not allowed": the rule fails closed.
 */

/** The id of VADOs' Companies. A server test pins it to ENT_VADO (server/enterprise/ids.ts), which the screens may not import. */
export const VADO_ENTERPRISE = 'ent_001';

/** True only for VADOs' Companies. Null, undefined and any other id give false. */
export function usageAllowed(ent: string | null | undefined): boolean {
  return ent === VADO_ENTERPRISE;
}
