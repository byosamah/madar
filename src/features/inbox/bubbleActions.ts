import { createContext, useContext } from 'react';
import type { Reaction } from '../../api/contract/entities';
import type { UserCard } from '../../api/contract/views';
import type { Bubble } from './MessageBubble';

/**
 * What a person may do with a bubble, from the pane that draws it (chat design 2026-10-19, item 9). The panes give one stable object
 * through BubbleActionsContext, so a memoized bubble renders again only when its own Bubble changes (`src/CLAUDE.md`, "Speed"), and no
 * track adds a handler prop to MessageLog. The ChatPane and the TaskPane each build their own.
 */
export type BubbleActions = {
  /** The name of the "..." button and of its menu: "Actions for this message" in a chat, "Actions for this comment" in a task thread. */
  menuLabel: string;
  /** True where a person may react (a chat that is open; a task thread for a person who may post). Else the pills are plain text. */
  canReact: boolean;
  /** The id of the person who reads: the reaction of this person has the ring. */
  meId: string;
  react(bubble: Bubble, emoji: Reaction): void;
  /** The people that a name in the text can point to (the edit form of a message). */
  people: UserCard[];
};

export const BubbleActionsContext = createContext<BubbleActions | null>(null);

/** The actions of the pane around a bubble, or null where a bubble stands alone (a test, a preview). */
export function useBubbleActions(): BubbleActions | null {
  return useContext(BubbleActionsContext);
}
