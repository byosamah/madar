import { forbidden, notFound } from '../../src/api/errors';
import { typingRecipients } from '../../src/api/chatState';
import { resolveActor } from '../core/actor';
import type { ServerCall } from '../core/types';

/**
 * chats.typing (chat presence design B, base B5): tells the other members of a chat that the person types, or stops. It saves nothing,
 * takes no lock and opens no transaction. The person comes from the sign-in, so no screen can name another typist. An agent never
 * types. A chat that the person cannot see answers with the same not_found text as chats.messages, and sends nothing. A person who may
 * read the chat and is no member (an Admin outside the team of a project chat) is told sent 0. Without a typing port (a host with no
 * sender yet) the call still answers, and tells nobody.
 */
export const chatsTyping: ServerCall<'chats.typing'> = async (input, ctx) => {
  const actor = resolveActor(ctx.office, ctx.principal);
  if (actor.kind === 'agent') throw forbidden('An agent does not type.', { action: 'chats.typing' });
  const people = typingRecipients(ctx.office.lists, input.conversationId, actor.id);
  if (people === null) throw notFound('Conversation', input.conversationId);
  if (people.length > 0) await ctx.deps.typing?.send(people, { v: 1, conversationId: input.conversationId, userId: actor.id, typing: input.typing, at: ctx.now.toISOString() });
  return { output: { sent: people.length }, changed: false };
};
