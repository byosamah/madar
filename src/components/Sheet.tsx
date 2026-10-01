import { AnimatedIcon } from './icons/AnimatedIcon';
import { XIcon } from './icons/animated/x';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from 'vaul';
import { usePanelOpen } from '../app/panelOpen';
import { useIsPhone } from '../app/useIsPhone';

/**
 * A sheet (spec 10.1 and 10.6): a bottom sheet on a phone that follows the finger, a side panel on the end side on desktop.
 * A blocking sheet dims the page and holds the focus. A non-blocking panel (the task panel) leaves the page usable.
 */
export function Sheet({
  open, onOpenChange, title, description, blocking = true, wide = false, footer, headerAction, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  blocking?: boolean;
  wide?: boolean;
  footer?: ReactNode;
  /** One quiet action next to the title, for example Focus on the task panel. */
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const direction = phone ? 'bottom' : rtl ? 'left' : 'right'; // rtl-ok: Vaul names the screen edge
  const modal = phone || blocking;
  usePanelOpen(open && modal);
  const shape = phone
    ? 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-sheet pb-[env(safe-area-inset-bottom)]'
    : `inset-y-3 end-3 rounded-sheet ${wide ? 'w-[min(40rem,calc(100vw-1.5rem))]' : 'w-[min(30rem,calc(100vw-1.5rem))]'}`;
  const described = description ? {} : { 'aria-describedby': undefined };
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={direction} modal={modal} handleOnly={!phone}>
      <Drawer.Portal>
        {modal && <Drawer.Overlay className="fixed inset-0 z-40 bg-[var(--c-scrim)]" />}
        <Drawer.Content {...described} className={`float fixed z-50 flex flex-col outline-none ${shape}`}>
          {phone && <Drawer.Handle className="mt-2" />}
          <div className="flex items-start gap-3 px-5 pb-2 pt-4">
            <div className="min-w-0 flex-1">
              <Drawer.Title className="text-section text-ink [text-wrap:balance]">{title}</Drawer.Title>
              {description && <Drawer.Description className="text-footnote text-label-2">{description}</Drawer.Description>}
            </div>
            {headerAction}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t('common.close')}
              className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-fill text-ink-2"
            >
              <AnimatedIcon icon={XIcon} size={18} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-3">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
