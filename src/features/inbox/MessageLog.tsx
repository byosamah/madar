import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../app/lang';
import { whenIdle } from '../../app/whenIdle';
import { Button } from '../../components/Button';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronDownIcon } from '../../components/icons/animated/chevron-down';
import { addDays, formatDay, stampDay, todayISO } from '../../lib/dates';
import { groupByDay } from '../../lib/group';
import { MessageBubble, type Bubble } from './MessageBubble';
import { isNearBottom, scrollTopFor } from './logScroll';
import { stageStartId } from './logStage';
import { firstUnreadId } from './newLine';
import { runStarts } from './runs';
import { SeenLine, type SeenInfo } from './SeenLine';

/**
 * The label of a day in a log: Today, Yesterday, or the long day in the screen language. The message log and the task panel both use it.
 * The day is read when the hook runs, so a render after midnight says the new day.
 */
export function useDayLabel(): (day: string) => string {
  const { t } = useTranslation();
  const lang = useLang();
  const today = todayISO();
  return (day) => (day === today ? t('inbox.today') : day === addDays(today, -1) ? t('inbox.yesterday') : formatDay(day, lang, 'long'));
}

/** The control for the earlier messages of a chat: absent when the chat has none left to show. */
export type EarlierControl = {
  /** True when a page arrived, false when it did not (the error shows as a toast). */
  load: () => Promise<boolean>;
  pending: boolean;
};

export type MessageLogProps = {
  bubbles: Bubble[];
  resetKey: string;
  emptyText: string;
  earlier?: EarlierControl;
  /** The read time of the reader from before the open (a chat). With `unreadAtOpen` it places the New line. A task thread leaves it out. */
  readUpTo?: string | null;
  /** How many messages were unread at the open. 0 or missing: no New line. */
  unreadAtOpen?: number;
  /**
   * The id of a message (a `msg_` or `cmt_` id, also a reason line) that the log scrolls to, puts in the middle and frames softly for
   * one second (items 10 and 17). The caller clears it after `onFocused`. It beats the New line at the open.
   */
  focusId?: string | null;
  /** Runs once, right after the log scrolled to the focus message. */
  onFocused?: () => void;
  /** The seen information of a chat (chat presence design C). A task thread leaves it out and shows no Seen line. */
  seen?: SeenInfo;
};

/** How long the soft frame of the focus message stays. */
export const FRAME_MS = 1000;

/**
 * The messages by day. The region scrolls to the bottom when a message arrives. New messages rise in. With `earlier`, the top of
 * the log has an "Earlier messages" control; its page goes above the shown messages, and the scroll keeps its distance from the
 * bottom, so the message the person reads stays in place.
 */
export function MessageLog({ bubbles, resetKey, emptyText, earlier, readUpTo, unreadAtOpen, focusId, onFocused, seen }: MessageLogProps) {
  const { t } = useTranslation();
  const dayLabel = useDayLabel();
  const region = useRef<HTMLDivElement>(null);
  const items = useRef<HTMLOListElement>(null);
  // True while the person reads the newest messages (the log is at its bottom, within 80 px). A picture grows its box when it has loaded,
  // and the log then keeps the bottom in view. A person who reads old messages is not moved.
  const atBottom = useRef(true);
  // The mirror of atBottom for the screen: the round Newest button shows while the reader is away from the bottom. It changes only at
  // the edge, so a scroll renders nothing else.
  const [away, setAway] = useState(false);
  // The message that wears the soft frame now, and the timer that takes it off. The timer stays when the caller clears the focus id.
  const [framedId, setFramedId] = useState<string | null>(null);
  const frameTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(frameTimer.current), []);
  // The newest time that the log has seen. A last message counts as new only when it is later than this (a delete or a restore of the
  // last message moves nothing).
  const seenNewest = useRef(Number.NEGATIVE_INFINITY);
  // The distance from the bottom when the person asked for earlier messages, and whether the focus was on that control.
  const anchor = useRef<{ fromBottom: number; focused: boolean; firstId: string | undefined } | null>(null);
  // The messages that are here when the log first shows do not animate. A message newer than all of them does. An earlier page
  // is older, so it shows at once: 200 bubbles that rise in together above the one the person reads are not calm.
  const [first] = useState(() => new Set(bubbles.map((b) => b.id)));
  const [newestAtFirst] = useState(() => Math.max(-Infinity, ...bubbles.map((b) => Date.parse(b.createdAt))));
  const firstId = bubbles[0]?.id;
  const lastId = bubbles.at(-1)?.id;
  // The New line (item 3) stays until the reader sends a message: a message of the reader that is newer than all that were here at the
  // open drops it. It leaves with the chat too, because the log is keyed by the chat. A task thread has no read time, so its count
  // walks back over the comments that were here at the open: a comment that comes later does not move the line.
  const sentSinceOpen = useMemo(() => bubbles.some((b) => b.mine && Date.parse(b.createdAt) > newestAtFirst), [bubbles, newestAtFirst]);
  const newLineId = useMemo(() => {
    if (sentSinceOpen || !unreadAtOpen) return null;
    const counted = readUpTo === undefined ? bubbles.filter((b) => !(Date.parse(b.createdAt) > newestAtFirst)) : bubbles;
    return firstUnreadId(counted, { unread: unreadAtOpen, readUpTo });
  }, [bubbles, sentSinceOpen, unreadAtOpen, readUpTo, newestAtFirst]);
  // The messages of one person within 5 minutes form a run (design item 2): only the first shows the face and the name.
  const starts = useMemo(() => runStarts(bubbles, newLineId), [bubbles, newLineId]);
  // The newest 60 bubbles mount at once and the others at an idle moment (performance audit 2026-10-21, RN-1). The focus message and the message
  // after the New line are always in the first mount. The log is keyed by the chat, so this runs once for a chat.
  const [stage, setStage] = useState(() => ({ startId: stageStartId(bubbles, [focusId, newLineId]), done: false }));
  const staged = !stage.done && stage.startId !== null;
  let from = 0;
  if (staged) {
    from = Math.max(0, bubbles.findIndex((b) => b.id === stage.startId));
    // A focus message that comes later (a press on a reply strip) is mounted at once too.
    const at = focusId ? bubbles.findIndex((b) => b.id === focusId) : -1;
    if (at >= 0 && at < from) from = at;
  }
  const drawn = from > 0 ? bubbles.slice(from) : bubbles;
  // The distance from the bottom when the older bubbles come, so a reader keeps the place (the same step as the earlier messages).
  const revealAnchor = useRef<number | null>(null);
  const reveal = () => {
    const log = region.current;
    if (log) revealAnchor.current = log.scrollHeight - log.scrollTop;
    setStage((now) => (now.done ? now : { ...now, done: true }));
  };
  useEffect(() => {
    if (!staged) return undefined;
    let live = true;
    whenIdle(() => {
      if (live) reveal();
    });
    return () => {
      live = false;
    };
  }, [staged]);
  // The Seen line sits under the last own message, and only when that message is saved (design C3). A message that waits shows none.
  const seenId = useMemo(() => {
    const last = seen ? bubbles.findLast((b) => b.mine && !b.line && !b.reason) : undefined;
    return last && last.status === undefined ? last.id : null;
  }, [bubbles, seen]);
  const focusPresent = focusId != null && bubbles.some((b) => b.id === focusId);
  const toBottom = (log: HTMLElement) => {
    log.scrollTop = log.scrollHeight;
    atBottom.current = true;
    setAway(false);
  };
  // The open: the log starts at its bottom. A new message moves the log only for a reader at the bottom, or for the sender (item 1).
  useLayoutEffect(() => {
    const log = region.current;
    seenNewest.current = newestAtFirst;
    if (!log) return;
    // The place of the open: the focus message first (its own effect below puts it in the middle), then the New line 16 px under the
    // top, then the bottom.
    if (focusPresent) return;
    const line = newLineId ? log.querySelector('[data-new-line]') : null;
    if (line) {
      log.scrollTop = scrollTopFor(log.scrollTop, log.getBoundingClientRect(), line.getBoundingClientRect(), 'start');
      atBottom.current = isNearBottom(log);
      setAway(!atBottom.current);
    } else toBottom(log);
  }, [resetKey]);
  // Open at one message (items 10 and 17): when the focus message is in the log, it goes to the middle and wears the frame for one second.
  useLayoutEffect(() => {
    const log = region.current;
    if (!log || !focusId || !focusPresent) return;
    const target = Array.from(log.querySelectorAll('[data-message-id]')).find((el) => el.getAttribute('data-message-id') === focusId);
    if (!target) return;
    log.scrollTop = scrollTopFor(log.scrollTop, log.getBoundingClientRect(), target.getBoundingClientRect(), 'center');
    atBottom.current = isNearBottom(log);
    setAway(!atBottom.current);
    setFramedId(focusId);
    clearTimeout(frameTimer.current);
    frameTimer.current = setTimeout(() => setFramedId(null), FRAME_MS);
    onFocused?.();
  }, [focusId, focusPresent]);
  const newestMine = bubbles.at(-1)?.mine ?? false;
  useLayoutEffect(() => {
    const last = bubbles.at(-1);
    const at = last ? Date.parse(last.createdAt) : Number.NaN;
    if (!(at > seenNewest.current)) {
      // The saved copy of the person's own message takes the place of its faded copy (item 13). It can be taller (its menu and its
      // pills), so a reader at the bottom stays at the bottom.
      if (last?.fromOutbox && atBottom.current && region.current) toBottom(region.current);
      return;
    }
    seenNewest.current = at;
    if (region.current && (atBottom.current || newestMine)) toBottom(region.current);
  }, [lastId]);
  useEffect(() => {
    const log = region.current;
    const list = items.current;
    if (!log || !list || typeof ResizeObserver === 'undefined') return undefined;
    const watcher = new ResizeObserver(() => {
      if (atBottom.current && !anchor.current) log.scrollTop = log.scrollHeight;
    });
    watcher.observe(list);
    return () => watcher.disconnect();
  }, []);
  useLayoutEffect(() => {
    const kept = revealAnchor.current;
    const log = region.current;
    if (!stage.done || kept === null || !log) return;
    revealAnchor.current = null;
    log.scrollTop = log.scrollHeight - kept;
    atBottom.current = isNearBottom(log);
    setAway(!atBottom.current);
  }, [stage.done]);
  const hasEarlier = earlier !== undefined;
  useLayoutEffect(() => {
    const log = region.current;
    const kept = anchor.current;
    // Only the arrival of the page counts: a new oldest message, or the control gone after an empty last page.
    if (!log || !kept || (firstId === kept.firstId && hasEarlier)) return;
    log.scrollTop = log.scrollHeight - kept.fromBottom;
    atBottom.current = isNearBottom(log);
    setAway(!atBottom.current);
    // The control goes after the first page of the chat. The focus then stays in the log, not on the page body.
    if (!hasEarlier && kept.focused) log.focus({ preventScroll: true });
    anchor.current = null;
  }, [firstId, hasEarlier]);
  const askEarlier = (control: EarlierControl, button: HTMLButtonElement) => {
    if (control.pending || !region.current) return;
    // The older bubbles that wait come first, so the page goes above all of them.
    if (staged) reveal();
    anchor.current = { fromBottom: region.current.scrollHeight - region.current.scrollTop, focused: document.activeElement === button, firstId };
    // A page that does not arrive moves nothing, so the kept distance goes. Else the next new message scrolls back to it.
    void control.load().then((loaded) => {
      if (!loaded) anchor.current = null;
    });
  };
  return (
    <div
      ref={region}
      role="log"
      tabIndex={-1}
      aria-label={t('chat.messages')}
      onScroll={(event) => {
        atBottom.current = isNearBottom(event.currentTarget);
        setAway(!atBottom.current);
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 outline-none [overflow-anchor:none] sm:px-5"
    >
      {earlier && (
        <div className="flex justify-center pb-2">
          {/* aria-disabled, not disabled: a disabled button drops the focus while the page loads. */}
          <Button variant="plain" aria-disabled={earlier.pending} aria-busy={earlier.pending} className={earlier.pending ? 'opacity-60' : ''} onClick={(event) => askEarlier(earlier, event.currentTarget)}>
            {t('chat.earlier')}
          </Button>
        </div>
      )}
      {bubbles.length === 0 && <p className="text-subheadline text-ink-2">{emptyText}</p>}
      <ol ref={items} className="flex flex-col gap-0.5">
        {groupByDay(drawn, (b) => stampDay(b.createdAt)).flatMap((group) => [
          <li key={`day-${group.day}`} className="self-center py-2 text-footnote font-semibold text-ink-2">{dayLabel(group.day)}</li>,
          ...group.items.flatMap((bubble) => [
            ...(bubble.id === newLineId
              ? [(
                <li key="new-line" data-new-line className="flex items-center gap-2.5 pt-3 text-footnote font-semibold text-link">
                  <span aria-hidden className="h-px flex-1 bg-link/55" />
                  <span>{t('chat.newLine')}</span>
                </li>
              )]
              : []),
            <MessageBubble key={bubble.id} bubble={bubble} runStart={starts.has(bubble.id)} namesMe={bubble.namesMe ?? false} framed={bubble.id === framedId} fresh={!first.has(bubble.id) && Date.parse(bubble.createdAt) > newestAtFirst} />,
            ...(seen && bubble.id === seenId ? [<SeenLine key="seen-line" info={seen} since={bubble.createdAt} />] : []),
          ]),
        ])}
      </ol>
      {/* The Newest button sits inside the scroll region, so the pane stays the parent of the log. Still, with no count and no motion. */}
      <div aria-live="off" className="pointer-events-none sticky bottom-3 flex h-0 justify-end">
        {away && (
          <button
            type="button"
            aria-label={t('chat.newest')}
            title={t('chat.newest')}
            onClick={() => {
              if (!region.current) return;
              toBottom(region.current);
              region.current.focus({ preventScroll: true });
            }}
            className="pressable pointer-events-auto grid size-11 -translate-y-full place-items-center rounded-full border border-hairline bg-panel text-ink shadow-float"
          >
            <AnimatedIcon icon={ChevronDownIcon} size={20} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
