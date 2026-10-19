import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommentView, ReplyRef, UserCard } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useAction, useCall } from '../../app/runtime';
import { useStableHandler } from '../../app/useStableHandler';
import { stampDay } from '../../lib/dates';
import { groupByDay } from '../../lib/group';
import { BubbleActionsContext, EditingContext, type BubbleActions } from '../inbox/bubbleActions';
import { bubbleOfComment, useBubbles } from '../inbox/bubbles';
import { MessageBubble } from '../inbox/MessageBubble';
import { FRAME_MS, useDayLabel } from '../inbox/MessageLog';
import { replyRefOfBubble } from '../inbox/ReplyStrip';
import { runStarts } from '../inbox/runs';
import { CommentItem } from './CommentItem';

/** A comment that did not go has no faded copy in the panel, so Send again never shows here. */
const NO_RETRY = () => undefined;

type TaskCommentsProps = {
  /** The id of the task. */
  targetId: string;
  list: CommentView[];
  /** The people that a name in a comment can point to. */
  people: UserCard[];
  /** True where the reader may react, reply and write (the project team, or the people of an office task). */
  canPost: boolean;
  /** Starts a reply: the box under the comments shows the strip. Give one stable function, so typing in the box renders no comment. */
  onReply: (ref: ReplyRef) => void;
};

/**
 * The comments of a task in the panel, drawn as the chat draws them (chat design 2026-10-19, item 6; B16): by day, in bubbles, in runs,
 * with the reaction pills and the message menu. The reason lines (a date move, a reopening, a Madar shift) keep their quiet line of
 * today. Only the look comes over: the comments stay in the scroll of the panel, with no Newest button and no "New" line. The box under
 * them lives in CommentThread. Memoized, so a key in that box renders no comment again (performance audit 2026-10-07, RND-3).
 */
export const TaskComments = memo(function TaskComments({ targetId, list, people, canPost, onReply }: TaskCommentsProps) {
  const { t } = useTranslation();
  const dayLabel = useDayLabel();
  const session = useCall('session.get', {});
  const me = session.data?.authority.id;
  const react = useAction('reactions.toggle');
  const update = useAction('comments.update');
  const remove = useUndoable('comments.delete', { message: () => t('comments.deleted') });
  const root = useRef<HTMLOListElement>(null);
  // The comment in edit, and the comment that wears the soft frame for one second after a press on a reply strip.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [framedId, setFramedId] = useState<string | null>(null);
  const frameTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(frameTimer.current), []);

  // The edit ends: the focus goes back to the menu button of that comment (the rule of useEditFocus, audit 2026-10-03, F-1). Only a focus
  // that went nowhere comes back: to the page, to the open panel itself, or still in this comment.
  const endEdit = useStableHandler(() => {
    const id = editingId;
    setEditingId(null);
    requestAnimationFrame(() => {
      const row = id ? root.current?.querySelector(`[data-message-id="${id}"]`) : null;
      const here = document.activeElement;
      if (row && (!here || here === document.body || here.getAttribute('role') === 'dialog' || row.contains(here))) {
        row.querySelector<HTMLElement>('[data-part="side"] button')?.focus();
      }
    });
  });
  // A press on a reply strip: the old comment goes to the middle of the panel and wears the soft frame for one second (items 10 and 17).
  const focusMessage = useStableHandler((id: string) => {
    const target = root.current?.querySelector(`[data-message-id="${id}"]`);
    if (!target) return;
    target.scrollIntoView?.({ block: 'center' });
    setFramedId(id);
    clearTimeout(frameTimer.current);
    frameTimer.current = setTimeout(() => setFramedId(null), FRAME_MS);
  });

  // One stable object for all the bubbles: a bubble renders again only when its own Bubble changes.
  const actions = useMemo<BubbleActions>(() => ({
    menuLabel: t('comments.actions'), canReact: canPost, meId: me ?? '', people,
    react: (bubble, emoji) => react.mutate({ commentId: bubble.id, emoji }),
    canReply: canPost, reply: (bubble) => onReply(replyRefOfBubble(bubble)),
    edit: (bubble) => setEditingId(bubble.id),
    remove: (bubble) => remove.mutate({ id: bubble.id }),
    saveEdit: (bubble, body) => update.mutate({ id: bubble.id, body }, { onSuccess: endEdit }),
    endEdit, retry: NO_RETRY, focusMessage,
  }), [t, canPost, me, people, onReply, react.mutate, update.mutate, remove.mutate, endEdit, focusMessage]);

  // "mine" depends on the reader, so the kept bubbles start again when the reader changes.
  const bubbles = useBubbles(list, (view) => bubbleOfComment(view, me), me);
  const starts = runStarts(bubbles);
  const rows = list.map((view, index) => ({ view, bubble: bubbles[index] }));
  return (
    <BubbleActionsContext.Provider value={actions}>
      <EditingContext.Provider value={editingId}>
        <ol ref={root} data-task-comments={targetId} className="flex flex-col gap-0.5">
          {groupByDay(rows, (row) => stampDay(row.bubble.createdAt)).flatMap((group) => [
            <li key={`day-${group.day}`} className="self-center py-2 text-footnote font-semibold text-ink-2">{dayLabel(group.day)}</li>,
            ...group.items.map(({ view, bubble }) => (bubble.reason
              ? <CommentItem key={bubble.id} view={view} people={people} canPost={canPost} />
              : (
                <MessageBubble
                  key={bubble.id}
                  bubble={bubble}
                  runStart={starts.has(bubble.id)}
                  namesMe={bubble.namesMe ?? false}
                  framed={bubble.id === framedId}
                  fresh={false}
                />
              ))),
          ])}
        </ol>
      </EditingContext.Provider>
    </BubbleActionsContext.Provider>
  );
});
