import { AI_SWITCHES, AI_SWITCH_LABELS, aiOffError, type AiSwitch } from '../../src/api/aiOff';
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

export { AI_SWITCHES, AI_SWITCH_LABELS, aiOffError, type AiSwitch };

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

/** True when the person holds ai.connect in this office. A person who is not in the office holds nothing. */
export function mayConnect(office: OfficeSnapshot, personId: string): boolean {
  const person = office.lists.users[personId];
  return person !== undefined && holdsRight(withRights(office.lists, person), 'ai.connect');
}

/** Throws the ai_off refusal when the person lacks ai.connect: a new connection, an approval and a first call stop here. */
export function assertMayConnect(office: OfficeSnapshot, personId: string): void {
  if (!mayConnect(office, personId)) throw aiOffError('ai.connect');
}
