import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../app/lang';
import { Button } from '../../components/Button';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronDownIcon } from '../../components/icons/animated/chevron-down';
import { addDays, formatDay, stampDay, todayISO } from '../../lib/dates';
import { groupByDay } from '../../lib/group';
import { MessageBubble, type Bubble } from './MessageBubble';
import { isNearBottom } from './logScroll';
import { runStarts } from './runs';

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

export type MessageLogProps = { bubbles: Bubble[]; resetKey: string; emptyText: string; earlier?: EarlierControl };

/**
 * The messages by day. The region scrolls to the bottom when a message arrives. New messages rise in. With `earlier`, the top of
 * the log has an "Earlier messages" control; its page goes above the shown messages, and the scroll keeps its distance from the
 * bottom, so the message the person reads stays in place.
 */
export function MessageLog({ bubbles, resetKey, emptyText, earlier }: MessageLogProps) {
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
  // The messages of one person within 5 minutes form a run (design item 2): only the first shows the face and the name.
  const starts = useMemo(() => runStarts(bubbles), [bubbles]);
  const toBottom = (log: HTMLElement) => {
    log.scrollTop = log.scrollHeight;
    atBottom.current = true;
    setAway(false);
  };
  // The open: the log starts at its bottom. A new message moves the log only for a reader at the bottom, or for the sender (item 1).
  useLayoutEffect(() => {
    if (region.current) toBottom(region.current);
    seenNewest.current = newestAtFirst;
  }, [resetKey]);
  const newestMine = bubbles.at(-1)?.mine ?? false;
  useLayoutEffect(() => {
    const last = bubbles.at(-1);
    const at = last ? Date.parse(last.createdAt) : Number.NaN;
    if (!(at > seenNewest.current)) return;
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
        {groupByDay(bubbles, (b) => stampDay(b.createdAt)).flatMap((group) => [
          <li key={`day-${group.day}`} className="self-center py-2 text-footnote font-semibold text-ink-2">{dayLabel(group.day)}</li>,
          ...group.items.map((bubble) => <MessageBubble key={bubble.id} bubble={bubble} runStart={starts.has(bubble.id)} namesMe={bubble.namesMe ?? false} fresh={!first.has(bubble.id) && Date.parse(bubble.createdAt) > newestAtFirst} />),
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
