import { ApiError } from '../../src/api/errors';
import { holdsRight } from '../../src/api/permissions';
import { withRights } from '../../src/api/rights';
import { MCP_TOOLS_BY_SWITCH } from '../../src/api/rightsCatalog';
import type { OfficeSnapshot } from '../core/types';

/**
 * The AI switches of the role sheet and the tools that each one opens (role rights version 2, design section 5.12). A person holds
 * a switch through the role of the person. An agent never holds more than its person, so the agent of a person without a switch has
 * no tool of that switch: the list leaves it out, and a call of it fails with forbidden and the reason ai_off.
 *
 * The map comes from MCP_TOOLS_BY_SWITCH (src/api/rightsCatalog.ts, the catalog JSON in docs). madar.readFirst and story.start have
 * no group: they need only ai.connect. ai.undoOthers has scopes and no tool of its own: the Undo rule of the History reads it.
 */

export const AI_SWITCHES = [
  'ai.connect', 'ai.readWork', 'ai.readChats', 'ai.todos', 'ai.posts', 'ai.messages', 'ai.meetings', 'ai.tracker', 'ai.projects', 'ai.payments',
  'ai.feedback', 'ai.report', 'ai.undo',
] as const;
export type AiSwitch = (typeof AI_SWITCHES)[number];

/** The names on the role sheet (the English labels of the catalog; a test compares them). */
export const AI_SWITCH_LABELS: Readonly<Record<AiSwitch, string>> = {
  'ai.connect': 'Connect AI assistants',
  'ai.readWork': 'AI reads work data',
  'ai.readChats': 'AI reads chats',
  'ai.todos': 'AI works on to-dos',
  'ai.posts': 'AI posts and comments',
  'ai.messages': 'AI sends messages',
  'ai.meetings': 'AI plans meetings',
  'ai.tracker': 'AI logs in the Tracker',
  'ai.projects': 'AI changes projects',
  'ai.payments': 'AI handles payments',
  'ai.feedback': 'AI reads requests and bugs',
  'ai.report': 'AI reads the office report',
  'ai.undo': 'AI undoes changes',
};

/** The tools with no group of their own: they need only ai.connect. */
const CONNECT_ONLY: readonly string[] = ['madar.readFirst', 'story.start'];

const SWITCH_OF_TOOL: ReadonlyMap<string, AiSwitch> = new Map<string, AiSwitch>([
  ...CONNECT_ONLY.map((tool) => [tool, 'ai.connect'] as const),
  ...Object.entries(MCP_TOOLS_BY_SWITCH).flatMap(([id, tools]) => (tools ?? []).map((tool) => [tool, id as AiSwitch] as const)),
]);

/** The AI switch that opens one tool, or undefined for a name that no switch opens. */
export function aiSwitchOf(tool: string): AiSwitch | undefined {
  return SWITCH_OF_TOOL.get(tool);
}

/** The tools of one AI switch, in the order of the catalog. ai.connect gives its two tools. */
export function toolsOfAiSwitch(id: AiSwitch): readonly string[] {
  return id === 'ai.connect' ? CONNECT_ONLY : (MCP_TOOLS_BY_SWITCH[id] ?? []);
}

/**
 * The refusal of a call or a connection whose AI switch is off. forbidden with the reason ai_off. The text names the switch in the
 * words of the role sheet, and tells the agent to stop and tell its person.
 */
export function aiOffError(id: AiSwitch): ApiError {
  const name = `"${AI_SWITCH_LABELS[id]}" (${id})`;
  const message = id === 'ai.connect'
    ? `The Admin turned off ${name} for the role of your person, so no AI assistant of this person works in Madar. Tell your person. Do not try another way.`
    : `The Admin turned off ${name} for the role of your person. Tell your person. Do not try another way.`;
  return new ApiError('forbidden', message, { reason: 'ai_off', right: id });
}

/** True when the person holds ai.connect in this office. A person who is not in the office holds nothing. */
export function mayConnect(office: OfficeSnapshot, personId: string): boolean {
  const person = office.lists.users[personId];
  return person !== undefined && holdsRight(withRights(office.lists, person), 'ai.connect');
}

/** Throws the ai_off refusal when the person lacks ai.connect: a new connection, an approval and a first call stop here. */
export function assertMayConnect(office: OfficeSnapshot, personId: string): void {
  if (!mayConnect(office, personId)) throw aiOffError('ai.connect');
}
