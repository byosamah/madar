import type { Conversation, Task } from '../contract/entities';
import { canSeeConversation, chatMemberIds } from '../chatState';
import { can, mayViewTask, principalOf, type Actor } from '../permissions';
import { ensureRights } from '../rights';
import type { State } from '../store';
import { mentionsEveryone } from '../../lib/text';

/**
 * @everyone, @all and @الجميع (owner, 2026-10-22, fbk_041). The one rule of who these words name, for a chat message and for a task comment.
 *
 * - A group: its members. A project chat: the leader and the team of its project. A direct chat: nobody (the words stay plain text).
 * - A to-do thread: the lead, the helpers, the maker and the project leader of the task. An office to-do has no project leader.
 * - Always active people, never an agent, never the sender (the person, or the person an agent writes for), and never a person who cannot
 *   open that chat or thread.
 * - Only a writer who holds "Mention everyone" (chat.mentionEveryone). Without it the words name nobody, and the answer tells nothing
 *   about who they would have named.
 * One function for the server and the prototype fake, so both give the same people.
 */

type Sender = { actor: Pick<Actor, 'id' | 'ownerId'>; authority: Actor };
type EveryoneState = Pick<State, 'users' | 'projects' | 'members' | 'conversations' | 'settings'>;

/** The sorted ids, each once, without the sender and without a person who is off or is an agent. */
function cleaned(state: Pick<State, 'users'>, ids: Iterable<string>, sender: Sender): string[] {
  const skip = new Set([sender.actor.id, sender.authority.id, ...(sender.actor.ownerId ? [sender.actor.ownerId] : [])]);
  return [...new Set(ids)].filter((id) => !skip.has(id) && state.users[id]?.kind === 'human' && state.users[id]?.active === true).sort();
}

/** The people that @everyone names in a chat. A direct chat names nobody. */
export function everyoneOfChat(state: EveryoneState, conversation: Conversation, sender: Sender): string[] {
  if (conversation.kind === 'direct') return [];
  return cleaned(state, chatMemberIds(state, conversation), sender).filter((id) => canSeeConversation(state, conversation, state.users[id]));
}

/** The people that @everyone names in the thread of a task. */
export function everyoneOfTask(state: EveryoneState & Pick<State, 'tasks'>, task: Task, sender: Sender): string[] {
  const leader = task.projectId === null ? undefined : state.projects[task.projectId]?.leaderId;
  const maker = principalOf(state as State, task.createdBy);
  const people = [...(task.ownerId ? [task.ownerId] : []), ...(task.helperIds ?? []), maker, ...(leader ? [leader] : [])];
  // An office to-do is for its own people and the holders of task.officeAll; a person who may not view it is not named.
  return cleaned(state, people, sender).filter((id) => task.projectId !== null || mayViewTask(state as State, ensureRights(state, state.users[id]), task));
}

/** True when the writer holds "Mention everyone". The check reads the person, so an agent writes with the rights of its person. */
export function mayMentionEveryone(authority: Actor): boolean {
  return can(authority, 'chat.mentionEveryone');
}

/** The count of people that @everyone names for the sender in a chat (0 when the sender lacks the switch). */
export function everyoneCountOfChat(ctx: Sender & { state: EveryoneState }, conversation: Conversation): number {
  return mayMentionEveryone(ctx.authority) ? everyoneOfChat(ctx.state, conversation, ctx).length : 0;
}

/** The count of people that @everyone names for the sender in the thread of a task (0 when the sender lacks the switch). */
export function everyoneCountOfTask(ctx: Sender & { state: EveryoneState & Pick<State, 'tasks'> }, task: Task): number {
  return mayMentionEveryone(ctx.authority) ? everyoneOfTask(ctx.state, task, ctx).length : 0;
}

/** The people named by the everyone words of a body, or none when the body holds no such word or the writer lacks the switch. */
export function namedByEveryone(body: string, authority: Actor, audience: () => string[]): string[] {
  return mentionsEveryone(body) && mayMentionEveryone(authority) ? audience() : [];
}
