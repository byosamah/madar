import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REACTIONS } from '../../api/contract/limits';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { listFormat } from '../../lib/dates';
import { useBubbleActions, type BubbleActions } from './bubbleActions';
import { useLongPress } from './longPress';
import type { Bubble } from './MessageBubble';

/**
 * The reactions under a bubble (chat design 2026-10-19, item 12): one small pill for each emoji in use, with the emoji and the count.
 * 28 px high, with a 44 px press area; the reaction of the reader has the thin blue ring. A press toggles it; the names come in the
 * `title` and, on a touch screen, with a long press. No faces. Where the reader may not react, a pill is plain text.
 */
export function ReactionPills({ bubble }: { bubble: Bubble }) {
  const used = REACTIONS.filter((emoji) => (bubble.reactions?.[emoji] ?? []).length > 0);
  return used.length === 0 ? null : <PillRow bubble={bubble} used={used} />;
}

/** The names of the people on one pill. A person who is not in the list (left the office) stays in the count, never in the names. */
function useNames(ids: readonly string[]): string {
  const users = useCall('users.list', {});
  const nameOf = usePersonName();
  const lang = useLang();
  const known = new Map((users.data ?? []).map((user) => [user.id, user]));
  return listFormat(lang).format(ids.flatMap((id) => (known.has(id) ? [nameOf(known.get(id)!)] : [])));
}

function PillRow({ bubble, used }: { bubble: Bubble; used: (typeof REACTIONS)[number][] }) {
  const { t } = useTranslation();
  const actions = useBubbleActions();
  // The pill whose names show in a small tip after a long press. The next press anywhere puts the tip away.
  const [tip, setTip] = useState<string | null>(null);
  useEffect(() => {
    if (tip === null) return undefined;
    const away = () => setTip(null);
    document.addEventListener('pointerdown', away, { capture: true, once: true });
    return () => document.removeEventListener('pointerdown', away, true);
  }, [tip]);
  return (
    <div role="group" aria-label={t('chat.reactions')} className={`flex flex-wrap gap-1 pt-1 ${bubble.mine ? 'justify-end' : 'justify-start'}`}>
      {used.map((emoji) => (
        <Pill key={emoji} bubble={bubble} emoji={emoji} actions={actions} tipped={tip === emoji} onTip={() => setTip(emoji)} />
      ))}
    </div>
  );
}

function Pill({ bubble, emoji, actions, tipped, onTip }: { bubble: Bubble; emoji: (typeof REACTIONS)[number]; actions: BubbleActions | null; tipped: boolean; onTip: () => void }) {
  const { t } = useTranslation();
  const ids = bubble.reactions?.[emoji] ?? [];
  const names = useNames(ids);
  const press = useLongPress(onTip);
  const mine = actions !== null && ids.includes(actions.meId);
  if (!actions?.canReact) {
    return <span title={names || undefined} className="tabular inline-flex h-7 min-w-11 items-center justify-center rounded-full bg-fill px-2 text-footnote">{emoji} {ids.length}</span>;
  }
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-pressed={mine}
        aria-label={t('comments.react', { emoji, n: ids.length })}
        title={names || undefined}
        {...press}
        // A long press on a pill is the pill's own: the row behind it opens no sheet.
        onPointerDown={(event) => {
          event.stopPropagation();
          press.onPointerDown?.(event);
        }}
        onClick={() => actions.react(bubble, emoji)}
        className={`pressable relative inline-flex h-7 min-w-11 items-center justify-center gap-1 rounded-full px-2 text-footnote after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] ${mine ? 'bg-fill-strong ring-1 ring-inset ring-accent' : 'bg-fill hover:bg-fill-strong'}`}
      >
        <span aria-hidden>{emoji}</span>
        <span className="tabular">{ids.length}</span>
      </button>
      {tipped && names && (
        <span role="tooltip" className="float absolute bottom-full start-0 z-10 mb-2 whitespace-nowrap rounded-xl px-3 py-2 text-footnote text-ink">{names}</span>
      )}
    </span>
  );
}
