import type { TFunction } from 'i18next';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REACTIONS } from '../../api/contract/limits';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useToast } from '../../app/toasts';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { Menu, type MenuItem } from '../../components/Menu';
import { Sheet } from '../../components/Sheet';
import { clockFormat } from '../../lib/dates';
import { firstLineOf, plainText } from '../../lib/text';
import { EmojiSheet } from '../emoji/EmojiButton';
import { EmojiFloat } from '../emoji/EmojiFloat';
import { EmojiLazy } from '../emoji/EmojiLazy';
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

/**
 * True when the phone sheet of a message has something to show: a reaction row, a Reply, an Edit or a Delete, or Copy text. A reader who
 * may not react, reply or edit, in a browser that cannot copy, gets no sheet from a long press, so no empty sheet opens (Direction D).
 */
export function sheetHasRows(bubble: Bubble, actions: BubbleActions): boolean {
  // The same rules as `itemGroups`: Reply needs canReply, and Edit and Delete need canEdit.
  return actions.canReact || actions.canReply || bubble.canEdit === true || canCopy();
}

/** The items of the menu on a computer, in order. */
export function menuItemsOf(bubble: Bubble, actions: BubbleActions, t: TFunction): MenuItem[] {
  const { first, last } = itemGroups(bubble, actions, t);
  return [...first, ...last];
}

/**
 * The three reactions as round buttons, for the head of the menu. A press changes the reaction of the reader and closes the menu. The
 * fourth button, +, opens the list of every emoji (chat presence design E1): it is no choice itself, so it is a plain menu item, and
 * `onMore` ends the menu.
 */
function ReactionRow({ bubble, actions, onMore }: { bubble: Bubble; actions: BubbleActions; onMore: () => void }) {
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
      <button
        type="button"
        role="menuitem"
        aria-label={t('chat.addReaction')}
        title={t('chat.addReaction')}
        tabIndex={-1}
        onClick={onMore}
        className="pressable grid size-11 place-items-center rounded-full bg-fill text-ink-2 hover:bg-fill-strong focus:bg-fill-strong focus:outline-none"
      >
        <AnimatedIcon icon={PlusIcon} size={20} aria-hidden />
      </button>
    </div>
  );
}

/**
 * The "..." button of a message and its menu, on a computer. It shows when the row has the pointer or the focus, and while its menu is
 * open, and never on a touch screen (a long press opens the sheet there). The head holds the three reactions and a +. The + ends the menu
 * and opens the list of every emoji at this button (chat presence design E1). A person who may not react and has no other item sees no button.
 */
export function MessageTools({ bubble }: { bubble: Bubble }) {
  const { t } = useTranslation();
  const actions = useBubbleActions();
  const wrap = useRef<HTMLSpanElement>(null);
  // The + of the menu: the menu ends (a new key makes it start closed), and the list of emoji opens at the "..." button of this message.
  const [menuKey, setMenuKey] = useState(0);
  const [picking, setPicking] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setAnchor(picking ? wrap.current?.querySelector<HTMLElement>('button[aria-haspopup="menu"]') ?? null : null);
  }, [picking, menuKey]);
  if (!actions) return null;
  const more = () => {
    setMenuKey((key) => key + 1);
    setPicking(true);
  };
  return (
    <span ref={wrap} className="contents">
      <Menu
        key={menuKey}
        label={actions.menuLabel}
        items={menuItemsOf(bubble, actions, t)}
        head={actions.canReact ? <ReactionRow bubble={bubble} actions={actions} onMore={more} /> : undefined}
        triggerClassName={`text-label-2 opacity-0 hover:bg-fill group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 ${actions.inSheet ? 'pointer-coarse:opacity-100' : 'pointer-coarse:hidden'}`}
      />
      {picking && anchor && (
        <EmojiFloat
          anchor={anchor}
          label={t('chat.addReaction')}
          onClose={(restoreFocus) => {
            setPicking(false);
            if (restoreFocus) requestAnimationFrame(() => anchor.focus());
          }}
        >
          <EmojiLazy
            layout="panel"
            onPick={(emoji) => {
              // One pick sets that reaction and ends the list.
              setPicking(false);
              actions.react(bubble, emoji);
              requestAnimationFrame(() => anchor.focus());
            }}
          />
        </EmojiFloat>
      )}
    </span>
  );
}

/** True where the browser can copy text. A browser without it shows no "Copy text". */
const canCopy = (): boolean => typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

/**
 * The phone sheet of a message (chat design 2026-10-19, item 9): the title names the sender and the time ("Your message" for the own),
 * the first line of the message is the preview, then a row of the three reactions and a +, then the items and "Copy text". A long press
 * opens it, because that press takes the place of the phone's own text selection. The + closes this sheet and opens the emoji sheet.
 */
export function MessageSheet({ bubble, open, onOpenChange }: { bubble: Bubble; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const toast = useToast();
  const actions = useBubbleActions();
  // The + of the sheet: this sheet closes first, and the sheet of every emoji opens in the next frame (a sheet inside a sheet fails in Vaul).
  const [picker, setPicker] = useState<'off' | 'wait' | 'on'>('off');
  useEffect(() => {
    if (picker !== 'wait') return undefined;
    const frame = requestAnimationFrame(() => setPicker('on'));
    return () => cancelAnimationFrame(frame);
  }, [picker]);
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
    <>
      {picker === 'on' && (
        <EmojiSheet
          onClose={() => onOpenChange(false)}
          onPick={(symbol) => {
            onOpenChange(false);
            actions.react(bubble, symbol);
          }}
        />
      )}
      <Sheet open={open && picker === 'off'} onOpenChange={onOpenChange} title={`${who} · ${clockFormat(lang).format(new Date(bubble.createdAt))}`} description={`\u2068${firstLineOf(bubble.body)}\u2069`}>
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
              <button
                type="button"
                aria-label={t('chat.addReaction')}
                onClick={() => setPicker('wait')}
                className="pressable grid size-14 place-items-center rounded-full bg-fill text-ink-2"
              >
                <AnimatedIcon icon={PlusIcon} size={24} aria-hidden />
              </button>
            </div>
          )}
          <div className="flex flex-col">
            {first.filter((item) => !item.hidden).map(row)}
            {canCopy() && row({ label: t('chat.copyText'), onSelect: () => void copy() })}
            {last.filter((item) => !item.hidden).map(row)}
          </div>
        </div>
      </Sheet>
    </>
  );
}
