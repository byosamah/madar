/**
 * The name of an agent user (owner, 2026-10-12). An agent was named after its AI app, so every agent read "Claude". Now it reads
 * "<first name of its person> <AI app> Agent", for example "Osama Claude Agent", so a list says whose agent it is and which AI app
 * it is. The Arabic name reads "وكيل <first name> <AI app>" and exists only when the person has an Arabic name.
 * The migration 20261012000100_agent_names.sql names the agents that exist already with the same rule: change both together.
 */

/** The longest name that a person record holds. */
const NAME_MAX = 80;
/** What `agentNameOf` (server/mcp/agentUser.ts) gives when the AI app sends no name. It is not an AI app. */
const UNKNOWN_APP = 'AI agent';

const firstWord = (name: string | undefined): string => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** Joins head, middle and tail with spaces, and cuts the middle (the AI app) so the whole stays within NAME_MAX and the ends stay. */
function fit(head: string, middle: string, tail: string): string {
  const room = NAME_MAX - head.length - tail.length - (head === '' ? 0 : 1) - (tail === '' ? 0 : 1);
  const kept = middle.slice(0, Math.max(0, room)).trim();
  return [head, kept, tail].filter(Boolean).join(' ');
}

export function agentNamesOf(owner: { name: string; nameAr?: string }, appName: string | null): { name: string; nameAr?: string } {
  const cleaned = (appName ?? '').replace(/\s+/g, ' ').trim();
  const app = cleaned === UNKNOWN_APP ? '' : cleaned;
  // An AI app that already ends with "Agent" ("Cursor Agent") does not get a second one.
  const ends = /\bagent$/i.test(app);
  const first = firstWord(owner.name);
  const firstAr = firstWord(owner.nameAr);
  const names: { name: string; nameAr?: string } = { name: fit(first, app, ends ? '' : 'Agent') };
  if (firstAr !== '') names.nameAr = fit('وكيل', [firstAr, app].filter(Boolean).join(' '), '');
  return names;
}
