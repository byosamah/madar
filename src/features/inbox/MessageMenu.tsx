import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { REACTIONS } from '../../api/contract/limits';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useToast } from '../../app/toasts';
import { Menu, type MenuItem } from '../../components/Menu';
import { Sheet } from '../../components/Sheet';
import { clockFormat } from '../../lib/dates';
import { firstLineOf, plainText } from '../../lib/text';
import { useBubbleActions, type BubbleActions } from './bubbleActions';
import type { Bubble } from './MessageBubble';

/**
 * The items of the message menu, in two groups (chat design 2026-10-19, item 9). The first group comes before "Copy text" on a phone
 * (Reply), the last after it (Edit, Delete). The reactions are not items: they sit in the head of the menu and in the top row of the
 * sheet. The items show only what the person may do with this bubble.
 */
function itemGroups(bubble: Bubble, actions: BubbleActions, t: TFunction): { first: MenuItem[]; last: MenuItem[] } {
  return {
    first: actions.canReply ? [{ label: t('chat.reply'), onSelect: () => actions.reply(bubble) }] : [],
    last: bubble.canEdit
      ? [
        { label: t('comments.edit'), onSelect: () => actions.edit(bubble) },
        { label: t('comments.delete'), onSelect: () => actions.remove(bubble), destructive: true },
      ]
      : [],
  };
}

/** The items of the menu on a computer, in order. */
export function menuItemsOf(bubble: Bubble, actions: BubbleActions, t: TFunction): MenuItem[] {
  const { first, last } = itemGroups(bubble, actions, t);
  return [...first, ...last];
}

/** The three reactions as round buttons, for the head of the menu. A press changes the reaction of the reader and closes the menu. */
function ReactionRow({ bubble, actions }: { bubble: Bubble; actions: BubbleActions }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('chat.reactions')} className="flex gap-1">
      {REACTIONS.map((emoji) => {
        const ids = bubble.reactions?.[emoji] ?? [];
        const mine = ids.includes(actions.meId);
        return (
          <button
            key={emoji}
            type="button"
            role="menuitemcheckbox"
            aria-checked={mine}
            aria-label={t('comments.react', { emoji, n: ids.length })}
            tabIndex={-1}
            onClick={() => actions.react(bubble, emoji)}
            className={`pressable grid size-11 place-items-center rounded-full text-xl leading-none focus:bg-fill-strong focus:outline-none ${mine ? 'bg-fill-strong ring-1 ring-inset ring-accent' : 'bg-fill hover:bg-fill-strong'}`}
          >
            <span aria-hidden>{emoji}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The "..." button of a message and its menu, on a computer. It shows when the row has the pointer or the focus, and while its menu is
 * open, and never on a touch screen (a long press opens the sheet there). The head holds the three reactions. A person who may not
 * react and has no other item sees no button.
 */
export function MessageTools({ bubble }: { bubble: Bubble }) {
  const { t } = useTranslation();
  const actions = useBubbleActions();
  if (!actions) return null;
  return (
    <Menu
      label={actions.menuLabel}
      items={menuItemsOf(bubble, actions, t)}
      head={actions.canReact ? <ReactionRow bubble={bubble} actions={actions} /> : undefined}
      triggerClassName="text-label-2 opacity-0 hover:bg-fill group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 pointer-coarse:hidden"
    />
  );
}

/** True where the browser can copy text. A browser without it shows no "Copy text". */
const canCopy = (): boolean => typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

/**
 * The phone sheet of a message (chat design 2026-10-19, item 9): the title names the sender and the time ("Your message" for the own),
 * the first line of the message is the preview, then a row of the three reactions, then the items and "Copy text". A long press
 * opens it, because that press takes the place of the phone's own text selection.
 */
export function MessageSheet({ bubble, open, onOpenChange }: { bubble: Bubble; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const toast = useToast();
  const actions = useBubbleActions();
  if (!actions) return null;
  const who = bubble.mine ? t('chat.yourMessage') : nameOf(bubble.author);
  const { first, last } = itemGroups(bubble, actions, t);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainText(bubble.body));
      toast.show({ message: t('chat.copied') });
    } catch (error) {
      toast.failed(error);
    }
  };
  const row = (item: MenuItem) => (
    <button
      key={item.label}
      type="button"
      onClick={() => {
        onOpenChange(false);
        item.onSelect();
      }}
      className={`flex min-h-14 w-full items-center rounded-xl px-3 text-start text-body hover:bg-fill focus:bg-fill focus:outline-none ${item.destructive ? 'text-late' : 'text-ink'}`}
    >
      {item.label}
    </button>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`${who} · ${clockFormat(lang).format(new Date(bubble.createdAt))}`} description={firstLineOf(bubble.body)}>
      <div className="flex flex-col gap-2">
        {actions.canReact && (
          <div role="group" aria-label={t('chat.reactions')} className="flex gap-2 pb-1">
            {REACTIONS.map((emoji) => {
              const ids = bubble.reactions?.[emoji] ?? [];
              const mine = ids.includes(actions.meId);
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={mine}
                  aria-label={t('comments.react', { emoji, n: ids.length })}
                  onClick={() => {
                    onOpenChange(false);
                    actions.react(bubble, emoji);
                  }}
                  className={`pressable grid size-14 place-items-center rounded-full text-2xl leading-none ${mine ? 'bg-fill-strong ring-1 ring-inset ring-accent' : 'bg-fill'}`}
                >
                  <span aria-hidden>{emoji}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-col">
          {first.filter((item) => !item.hidden).map(row)}
          {canCopy() && row({ label: t('chat.copyText'), onSelect: () => void copy() })}
          {last.filter((item) => !item.hidden).map(row)}
        </div>
      </div>
    </Sheet>
  );
}
