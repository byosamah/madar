import type { User } from '../api/contract/entities';
import { addGroupConversation } from '../api/chatState';
import { chatReadKey, nextId, type State } from '../api/store';
import { addDays } from '../lib/dates';
import { mentionMarkup } from '../lib/text';

const at = (day: string, hour: number, minute = 0): string =>
  `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+03:00`;

/**
 * The sample group chat (UX audit 2026-10-19, INT-08): "Facade review", four people, made by Faisal, with one message that names the
 * Admin and one quiet line ("Faisal added Reem"). The Inbox of the prototype, the screenshots and the deploy suite then show a group,
 * its picture, its People sheet and its lines, not only an empty state. Every member has read it, so the unread numbers of the sample
 * stay as they were. A migration of the saved sample office can call this too.
 */
export function addSampleGroupChat(state: State, today: string, humans: User[]): void {
  if (Object.values(state.conversations).some((c) => c.kind === 'group')) return;
  const [hala, faisal, reem, , sara] = [humans[0], humans[1], humans[2], humans[3], humans[4]];
  if (!hala || !faisal || !reem || !sara) return;
  const group = addGroupConversation(state, 'Facade review', faisal.id, [faisal.id, hala.id, sara.id], at(addDays(today, -3), 9));
  const talk: Array<{ by: User; days: number; hour: number; minute: number; text: string }> = [
    { by: faisal, days: 3, hour: 9, minute: 5, text: 'I made this group for the facade review of the tower.' },
    { by: sara, days: 2, hour: 9, minute: 20, text: 'The louver sample arrives on Thursday. I will bring it to the meeting room.' },
    { by: reem, days: 1, hour: 10, minute: 0, text: `${mentionMarkup(hala.name, hala.id)} please confirm the facade colors with the client.` },
  ];
  const stamps: string[] = [];
  for (const line of talk) {
    const id = nextId(state, 'msg');
    const createdAt = at(addDays(today, -line.days), line.hour, line.minute);
    stamps.push(createdAt);
    state.messages[id] = {
      id, conversationId: group.id, authorId: line.by.id, actingForId: line.by.id, body: line.text,
      mentions: [...line.text.matchAll(/\((usr_\d{3,})\)/g)].map((m) => m[1]), createdAt, editedAt: null,
    };
  }
  // Reem joins after the first two messages, and the quiet line says so.
  state.conversations[group.id] = {
    ...group,
    memberIds: [...group.memberIds, reem.id],
    log: [{ id: 'gl1', at: at(addDays(today, -2), 9, 40), type: 'added', actorId: faisal.id, personIds: [reem.id] }],
  };
  for (const member of [faisal, hala, sara, reem]) {
    state.chatReads[chatReadKey(group.id, member.id)] = { conversationId: group.id, userId: member.id, lastReadAt: stamps.at(-1) ?? '' };
  }
}
