import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { SmileIcon } from '../../components/icons/animated/smile';
import { Sheet } from '../../components/Sheet';
import { useIsPhone } from '../../app/useIsPhone';
import { EmojiFloat } from './EmojiFloat';
import { EmojiLazy } from './EmojiLazy';

/** What a screen can ask of the button from outside. */
export type EmojiButtonHandle = {
  /** Closes the panel, for the Send path and for a pick that ends it. The focus stays where the screen put it, unless `restoreFocus` is true. */
  close: (restoreFocus?: boolean) => void;
};

/**
 * The emoji panel on a phone: a bottom sheet. It stays open for more picks; a swipe down or a press outside closes it (chat presence
 * design D3). The reaction + of a message sheet uses it too.
 */
export function EmojiSheet({ onClose, onPick }: { onClose: () => void; onPick: (emoji: string) => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title={t('emoji.add')} blocking={false}>
      <EmojiLazy layout="sheet" onPick={onPick} />
    </Sheet>
  );
}

/**
 * The round smiley button of a message box (chat presence design D1), and its panel. On a computer the panel floats above the button; on
 * a phone it is a bottom sheet. A button inside a dialog (the task panel is a sheet on a phone, and a sheet cannot open inside a sheet)
 * floats on a phone too. The first open loads the panel with import(). The panel stays open after a pick. Escape ends it and the focus goes
 * to `returnTo` (the text box) or else to the button; a press outside leaves the focus where the person put it.
 */
export function EmojiButton({ onPick, label, icon = 'smile', returnTo, ref }: {
  onPick: (emoji: string) => void;
  /** The name of the button. Default: "Add an emoji". */
  label?: string;
  icon?: 'smile' | 'plus';
  /** The element that takes the focus when Escape closes the float. Default: the button. */
  returnTo?: () => HTMLElement | null;
  ref?: Ref<EmojiButtonHandle>;
}) {
  const { t } = useTranslation();
  const name = label ?? t('emoji.add');
  const phone = useIsPhone();
  const button = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<'float' | 'sheet' | null>(null);
  const close = useCallback((restoreFocus: boolean) => {
    setMode(null);
    if (restoreFocus) requestAnimationFrame(() => (returnTo?.() ?? button.current)?.focus());
  }, [returnTo]);
  useImperativeHandle(ref, () => ({ close: (restoreFocus = false) => close(restoreFocus) }), [close]);
  const toggle = () => {
    if (mode) {
      close(false);
      return;
    }
    setMode(phone && !button.current?.closest('[role="dialog"]') ? 'sheet' : 'float');
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={name}
        title={name}
        aria-haspopup="dialog"
        aria-expanded={mode !== null}
        onClick={toggle}
        className="pressable grid size-11 shrink-0 place-items-center rounded-full text-label-2 hover:bg-fill"
      >
        <AnimatedIcon icon={icon === 'plus' ? PlusIcon : SmileIcon} size={20} aria-hidden />
      </button>
      {mode === 'float' && button.current && (
        <EmojiFloat anchor={button.current} label={name} onClose={close}>
          <EmojiLazy layout="panel" onPick={onPick} />
        </EmojiFloat>
      )}
      {mode === 'sheet' && <EmojiSheet onClose={() => close(false)} onPick={onPick} />}
    </>
  );
}
