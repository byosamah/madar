import { ApiError } from './errors';
import { type Actor, holdsRight } from './permissions';

/**
 * The AI switches of the role sheet and the refusal of a switch that is off (role rights version 2, design section 5.12). The list, the
 * names and the refusal live here, in src/api, so the rules of the contract can ask a switch too: a file of a chat needs "AI reads chats",
 * and an upload into a chat needs "AI sends messages", as chats.messages and chats.send need them. server/mcp/aiSwitches.ts re-exports all
 * of this and adds the tool map.
 */

export const AI_SWITCHES = [
  'ai.connect', 'ai.readWork', 'ai.readChats', 'ai.todos', 'ai.posts', 'ai.messages', 'ai.meetings', 'ai.tracker', 'ai.projects', 'ai.projectSetup', 'ai.payments',
  'ai.feedback', 'ai.report', 'ai.admin', 'ai.myState', 'ai.undo',
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
  'ai.projectSetup': 'AI creates projects and clients',
  'ai.payments': 'AI handles payments',
  'ai.feedback': 'AI reads requests and bugs',
  'ai.report': 'AI reads the office report',
  'ai.admin': 'AI does Admin work',
  'ai.myState': 'AI changes my own marks and settings',
  'ai.undo': 'AI undoes changes',
};

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

/**
 * An agent acts with the rights of its person, and also needs the AI switch of the thing it does. A person at the screen needs no AI
 * switch. `authority` is the person whose rights apply, with the office rights attached. It throws the ai_off refusal when the switch is off.
 */
export function assertAiSwitch(actor: { kind: string }, authority: Actor, id: AiSwitch): void {
  if (actor.kind === 'agent' && !holdsRight(authority, id)) throw aiOffError(id);
}
