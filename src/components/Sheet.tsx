import { AnimatedIcon } from './icons/AnimatedIcon';
import { XIcon } from './icons/animated/x';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Drawer } from 'vaul';
import { usePanelOpen } from '../app/panelOpen';
import { isToastPress, useSheetToasts } from '../app/toasts';
import { useIsPhone } from '../app/useIsPhone';
import { spring } from '../design/motion';

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  blocking?: boolean;
  wide?: boolean;
  /** On a desk the sheet fills the screen, 12 px from each edge. A work area such as the template editor uses it. A phone is unchanged. */
  full?: boolean;
  footer?: ReactNode;
  /** One quiet action next to the title, for example Focus on the task panel. */
  headerAction?: ReactNode;
  /** A required step: a press outside does not close it. Escape and the sheet's own buttons still do (audit 2026-10-03, F-16). */
  keepOnOutsidePress?: boolean;
  /** On a phone the sheet takes the full free height, not only the height of its content. A desk ignores it. */
  tall?: boolean;
  /** On a phone this replaces the visible title text. The real title stays as sr-only text. The headerAction and Close stay in the row. A desk ignores it. */
  phoneHeader?: ReactNode;
  /** Runs once when the close animation ends, also when the parent closed the sheet. It does not run when the sheet opens again first. */
  onClosed?: () => void;
  children: ReactNode;
};

/** The close animation of a bottom sheet (vaul: 0.5 s). */
const CLOSE_MS = 500;

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
  // A control marked data-autofocus takes the focus first: the safe choice of a question, which has no field to type in.
  const wanted = sheet.querySelector<HTMLElement>('[data-autofocus]');
  wanted?.focus();
  if (wanted && document.activeElement === wanted) return;
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

/**
 * Escape belongs to the layer that holds the focus (cleanup 2026-10-06). True when an Escape belongs to a layer inside this sheet:
 * a menu, a field with its list of names open (MentionField), or another dialog. A layer that took the Escape already
 * (defaultPrevented) owns it too. Then the sheet stays open.
 */
export function escapeIsInner(event: Event, sheet: Element | null): boolean {
  if (event.defaultPrevented) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return false;
  if (target.matches('[aria-autocomplete][aria-controls]')) return true;
  const layer = target.closest('[role="dialog"], [role="menu"], [role="listbox"]');
  return layer !== null && layer !== sheet;
}

const isRtl = () => typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
const widthOf = (wide: boolean, full = false) => (full ? 'w-[calc(100vw-1.5rem)]' : wide ? 'w-[min(40rem,calc(100vw-1.5rem))]' : 'w-[min(30rem,calc(100vw-1.5rem))]');
/**
 * The place of a sheet on a desk: 12 px from the end, the top and the bottom of the screen. On a screen with the tab pill
 * (16 px from the top, 58 px high) the sheet starts 84 px from the top, 10 px below the pill. Before, a panel covered the
 * end of the pill, with the bell and its count, and the person could not press the bell next to the task panel (owner,
 * 2026-10-06). Both kinds of sheet use it. The meeting view has no pill, so there a sheet keeps the 12 px.
 */
const DESK_EDGE = 'top-3 [:root:has([data-pill])_&]:top-[5.25rem] bottom-3 end-3';
/**
 * A bottom sheet on a phone leaves a strip at the top of the screen, 84 px below the safe area. While a sheet is open, the
 * toasts show in that strip, so a toast covers no field of the sheet (owner, 2026-10-06, see the ToastProvider). A toast with
 * Undo is 62 px high and sits 12 px from the top, so 10 px stay free between the toast and the sheet.
 */
const PHONE_HEIGHT = 'max-h-[calc(100dvh_-_5.25rem_-_env(safe-area-inset-top))]';
/** A tall sheet (Direction D: the task panel, the project More tab) takes all of that free height. */
const PHONE_TALL = 'h-[calc(100dvh_-_5.25rem_-_env(safe-area-inset-top))]';

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
function SidePanel({ open, onOpenChange, title, description, wide = false, full = false, footer, headerAction, children }: SheetProps) {
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
      if (event.key === 'Escape' && !escapeIsInner(event, panel.current)) close.current(false);
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
          className={`float fixed ${DESK_EDGE} z-50 flex flex-col rounded-sheet outline-none ${widthOf(wide, full)}`}
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
  const { open, onOpenChange, title, description, blocking = true, wide = false, full = false, footer, headerAction, keepOnOutsidePress = false, tall = false, phoneHeader, onClosed, children } = props;
  const phone = useIsPhone();
  const direction = phone ? 'bottom' : isRtl() ? 'left' : 'right'; // rtl-ok: Vaul names the screen edge
  const modal = phone || blocking;
  usePanelOpen(open && modal);
  // The toasts make way for every open sheet, the panel too: see useSheetToasts (owner, 2026-10-06).
  useSheetToasts(open);
  const content = useRef<HTMLDivElement>(null);
  // Radix skips onOpenAutoFocus when a field inside took the focus first (autoFocus), so the note is taken as the sheet opens.
  const giveFocusBack = useFocusReturn(open && modal, content);
  // onClosed follows the close of the sheet, whoever closed it. Vaul calls its own end callback only for a close that starts inside
  // vaul, not when the parent sets open to false, so the sheet times the animation itself.
  const lastClosed = useRef(onClosed);
  lastClosed.current = onClosed;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return undefined;
    }
    if (!wasOpen.current) return undefined;
    wasOpen.current = false;
    const timer = window.setTimeout(() => lastClosed.current?.(), CLOSE_MS);
    return () => {
      window.clearTimeout(timer);
      wasOpen.current = true;
    };
  }, [open]);
  if (!modal) return <SidePanel {...props} />;
  // Vaul draws a strip in the colour of the sheet on the side of the screen edge, for a pull past the end. The bottom sheet keeps
  // it. A side sheet floats 12 px from the edge and has no pull, so there the strip only filled the gap beside the rounded
  // corners (owner, 2026-10-05, item 5).
  const shape = phone
    ? `inset-x-0 bottom-0 ${PHONE_HEIGHT} ${tall ? PHONE_TALL : ''} rounded-t-sheet pb-[env(safe-area-inset-bottom)]`
    : `${DESK_EDGE} rounded-sheet after:hidden ${widthOf(wide, full)}`;
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
          // Escape in a "…" menu or an open list of names inside the sheet closes that layer only (audit 2026-10-03, SHL-1). Radix
          // asks before the layer itself hears the key, so the rule looks at where the key was pressed.
          onEscapeKeyDown={(event) => {
            if (escapeIsInner(event, content.current)) event.preventDefault();
          }}
          className={`float fixed z-50 flex flex-col outline-none ${shape}`}
        >
          {phone && <Drawer.Handle className="mt-2" />}
          <Frame
            heading={(
              <>
                <Drawer.Title data-sheet-title tabIndex={-1} className={phone && phoneHeader ? 'sr-only' : `${TITLE} outline-none`}>{title}</Drawer.Title>
                {phone && phoneHeader}
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
