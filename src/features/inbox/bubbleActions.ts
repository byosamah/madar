import { createContext, useContext } from 'react';
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
  react(bubble: Bubble, emoji: string): void;
  /** True where the box shows (a chat that is open; a task thread for a person who may post): the menu then offers Reply. */
  canReply: boolean;
  /** Starts a reply to this bubble: the strip shows in the box and the focus goes into the field. */
  reply(bubble: Bubble): void;
  /** Opens the edit of an own bubble in place of its words. */
  edit(bubble: Bubble): void;
  /** Deletes an own bubble: a chat message goes with an Undo toast, a task comment as before. */
  remove(bubble: Bubble): void;
  /** Saves the edited words, then closes the edit. */
  saveEdit(bubble: Bubble, body: string): void;
  /** Closes the edit and puts the focus back into the box. */
  endEdit(): void;
  /** Sends a message that did not go once more, with the same key (instant send, item 13). */
  retry(bubble: Bubble): void;
  /**
   * Goes to an old message or comment that a reply strip points to: the log puts it in the middle and frames it for one second (items 10
   * and 17). A strip of a deleted message has no press, so this never gets a deleted id.
   */
  focusMessage(id: string): void;
  /** The people that a name in the text can point to (the edit form of a message). */
  people: UserCard[];
  /**
   * True in the task panel, which is a bottom sheet on a phone: a second bottom sheet cannot open inside it, so a finger gets the "..."
   * button there and no long press. Missing: a chat, where a long press opens the sheet of the message (item 9).
   */
  inSheet?: boolean;
};

export const BubbleActionsContext = createContext<BubbleActions | null>(null);

/**
 * The id of the bubble in edit, or null. A bubble reads it to draw its edit form. A start or an end of an edit renders the bubbles once,
 * which is calm for an act this rare.
 */
export const EditingContext = createContext<string | null>(null);

/** The actions of the pane around a bubble, or null where a bubble stands alone (a test, a preview). */
export function useBubbleActions(): BubbleActions | null {
  return useContext(BubbleActionsContext);
}
