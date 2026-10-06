import { AnimatedIcon } from './icons/AnimatedIcon';
import { XIcon } from './icons/animated/x';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Drawer } from 'vaul';
import { usePanelOpen } from '../app/panelOpen';
import { isToastPress } from '../app/toasts';
import { useIsPhone } from '../app/useIsPhone';
import { spring } from '../design/motion';

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  blocking?: boolean;
  wide?: boolean;
  footer?: ReactNode;
  /** One quiet action next to the title, for example Focus on the task panel. */
  headerAction?: ReactNode;
  /** A required step: a press outside does not close it. Escape and the sheet's own buttons still do (audit 2026-10-03, F-16). */
  keepOnOutsidePress?: boolean;
  children: ReactNode;
};

const TITLE = 'text-section text-ink [text-wrap:balance]';
const DESCRIPTION = 'text-footnote text-label-2';
/** A field a person types or picks in: the first one takes the focus when a sheet opens. */
const FIELD = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';

/**
 * Vaul never moves the focus into a sheet (its autoFocus is off), so a keyboard stayed behind the sheet and a screen reader
 * did not hear it open. The sheet now gives the focus to its first field, or to its title (audit 2026-10-03, BRW-2). On a
 * phone the title takes it, so the keyboard does not pop up over the sheet.
 */
function focusInto(sheet: HTMLElement | null, phone: boolean): void {
  if (!sheet) return;
  const field = phone ? null : sheet.querySelector<HTMLElement>(FIELD);
  field?.focus();
  if (!field || document.activeElement !== field) sheet.querySelector<HTMLElement>('[data-sheet-title]')?.focus();
}

/**
 * Gives the focus back when a sheet closes and the focus has nowhere to be. First the control that opened the sheet. When the
 * screen built that control again, its new copy with the same id. Else the panel or dialog that held the control, else the
 * page title. Never the page body, where the next Tab goes to Home (audit 2026-10-03, V-10).
 */
function focusBack(opener: HTMLElement | null, holder: HTMLElement | null): void {
  const copy = opener && !opener.isConnected && opener.id ? document.getElementById(opener.id) : null;
  for (const target of [opener, copy, holder]) {
    if (!target?.isConnected) continue;
    target.focus();
    if (document.activeElement === target) return;
  }
  const title = document.querySelector<HTMLElement>('main h1');
  if (!title) return;
  if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
  title.focus();
}

/** The focus is lost when it is on the page body or still inside the sheet that closes. */
export const focusLost = (sheet: HTMLElement | null) => {
  const active = document.activeElement;
  return !active || active === document.body || Boolean(sheet?.contains(active));
};

/**
 * Notes the control that has the focus when a sheet opens, and returns the step that gives the focus back when it closes
 * (focusBack). The blocking sheet and the non-blocking panel both use it, so both follow one rule (cleanup 2026-10-06).
 * The note is taken as the sheet opens, before the focus moves. Radix gives the focus back to a Dialog.Trigger only, and the app
 * opens sheets from its own buttons (audit 2026-10-03, BRW-2). A run that finds the focus already in the sheet keeps the note:
 * a field inside took the focus first (autoFocus, audit 2026-10-03, V-10), or React StrictMode ran the effects a second time
 * (audit 2026-10-03, sheet repair).
 */
function useFocusReturn(open: boolean, sheet: RefObject<HTMLElement | null>): () => void {
  // The control, and the panel or dialog that held it: a removed control has no parents left to ask.
  const noted = useRef<{ control: HTMLElement; holder: HTMLElement | null } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && sheet.current?.contains(active)) return;
    noted.current = active instanceof HTMLElement && active !== document.body
      ? { control: active, holder: active.closest<HTMLElement>('[role="dialog"]') }
      : null;
  }, [open, sheet]);
  return useCallback(() => {
    if (focusLost(sheet.current)) focusBack(noted.current?.control ?? null, noted.current?.holder ?? null);
  }, [sheet]);
}

const isRtl = () => typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
const widthOf = (wide: boolean) => (wide ? 'w-[min(40rem,calc(100vw-1.5rem))]' : 'w-[min(30rem,calc(100vw-1.5rem))]');

/** The inside of a sheet or a panel: the title row with its Close button, the content, and the footer. */
function Frame({ heading, onClose, headerAction, footer, children }: { heading: ReactNode; onClose: () => void; headerAction?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-start gap-3 px-5 pb-2 pt-4">
        <div className="min-w-0 flex-1">{heading}</div>
        {headerAction}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-fill text-ink-2"
        >
          <AnimatedIcon icon={XIcon} size={18} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-3">{footer}</div>}
    </>
  );
}

/**
 * The non-blocking panel on a computer (the task panel): no dim layer, no focus trap, and the page stays readable for screen
 * readers, so a person can keep working on the page next to it (spec 5.4). Vaul always runs its dialog as modal, so this
 * panel does not use it (audit 2026-10-03, SHL-2). Escape closes it; the focus goes back to where it was before it opened.
 */
function SidePanel({ open, onOpenChange, title, description, wide = false, footer, headerAction, children }: SheetProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onOpenChange);
  close.current = onOpenChange;
  const giveFocusBack = useFocusReturn(open, panel);
  useEffect(() => {
    if (!open) return undefined;
    // The focus moves into the panel, so Tab reaches its controls next. A control inside that took the focus keeps it.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape in a menu, a list or another dialog belongs to that layer.
      const layer = event.target instanceof Element ? event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]') : null;
      if (layer && layer !== panel.current) return;
      close.current(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      giveFocusBack();
    };
  }, [open, giveFocusBack]);
  const away = isRtl() ? '-110%' : '110%';
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panel}
          role="dialog"
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-description` : undefined}
          tabIndex={-1}
          initial={{ x: away }}
          animate={{ x: 0 }}
          exit={{ x: away }}
          transition={spring.standard}
          className={`float fixed inset-y-3 end-3 z-50 flex flex-col rounded-sheet outline-none ${widthOf(wide)}`}
        >
          <Frame
            heading={(
              <>
                <h2 id={`${id}-title`} className={TITLE}>{title}</h2>
                {description && <p id={`${id}-description`} className={DESCRIPTION}>{description}</p>}
              </>
            )}
            onClose={() => onOpenChange(false)}
            headerAction={headerAction}
            footer={footer}
          >
            {children}
          </Frame>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * A sheet (spec 10.1 and 10.6): a bottom sheet on a phone that follows the finger, a side panel on the end side on desktop.
 * A blocking sheet dims the page and holds the focus. A non-blocking panel (the task panel) leaves the page usable.
 */
export function Sheet(props: SheetProps) {
  const { open, onOpenChange, title, description, blocking = true, wide = false, footer, headerAction, keepOnOutsidePress = false, children } = props;
  const phone = useIsPhone();
  const direction = phone ? 'bottom' : isRtl() ? 'left' : 'right'; // rtl-ok: Vaul names the screen edge
  const modal = phone || blocking;
  usePanelOpen(open && modal);
  const content = useRef<HTMLDivElement>(null);
  // Radix skips onOpenAutoFocus when a field inside took the focus first (autoFocus), so the note is taken as the sheet opens.
  const giveFocusBack = useFocusReturn(open && modal, content);
  if (!modal) return <SidePanel {...props} />;
  // Vaul draws a strip in the colour of the sheet on the side of the screen edge, for a pull past the end. The bottom sheet keeps
  // it. A side sheet floats 12 px from the edge and has no pull, so there the strip only filled the gap beside the rounded
  // corners (owner, 2026-10-05, item 5).
  const shape = phone
    ? 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-sheet pb-[env(safe-area-inset-bottom)]'
    : `inset-y-3 end-3 rounded-sheet after:hidden ${widthOf(wide)}`;
  const described = description ? {} : { 'aria-describedby': undefined };
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={direction} modal handleOnly={!phone}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-[var(--c-scrim)]" />
        <Drawer.Content
          ref={content}
          {...described}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            focusInto(content.current, phone);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            giveFocusBack();
          }}
          // A press on a toast (its Undo) is not a press outside the sheet, so the sheet stays open (audit 2026-10-03, SHL-3).
          // The toast can be gone from the page when Radix asks, so the check uses the press itself (audit 2026-10-03, V-11).
          onPointerDownOutside={(event) => {
            if (keepOnOutsidePress || isToastPress(event.detail.originalEvent)) event.preventDefault();
          }}
          // Escape in a "…" menu inside the sheet closes the menu only (audit 2026-10-03, SHL-1).
          onEscapeKeyDown={(event) => {
            if (event.target instanceof Element && event.target.closest('[role="menu"]')) event.preventDefault();
          }}
          className={`float fixed z-50 flex flex-col outline-none ${shape}`}
        >
          {phone && <Drawer.Handle className="mt-2" />}
          <Frame
            heading={(
              <>
                <Drawer.Title data-sheet-title tabIndex={-1} className={`${TITLE} outline-none`}>{title}</Drawer.Title>
                {description && <Drawer.Description className={DESCRIPTION}>{description}</Drawer.Description>}
              </>
            )}
            onClose={() => onOpenChange(false)}
            headerAction={headerAction}
            footer={footer}
          >
            {children}
          </Frame>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
