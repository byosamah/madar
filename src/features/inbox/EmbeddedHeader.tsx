import type { ReactNode } from 'react';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { XIcon } from '../../components/icons/animated/x';

/**
 * A chat pane that sits inside another screen (Focus mode, fbk_059) and not in the Inbox. `page`: the pane fills a full page over the
 * screen, so its one control is a Back button (its label is "Back to focus"). Otherwise it is a side panel with a Close button.
 * The pane then has no Back link to the Inbox, no menu, no Search, no typing line, and nothing in it leaves the screen.
 */
export type EmbeddedChat = {
  page: boolean;
  label: string;
  onClose: () => void;
  /** A row under the head, before the messages: the switch between the project chat and the to-do thread (owner, 2026-10-25). */
  below?: ReactNode;
};

const ROUND = 'pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink';

/**
 * The slim head of an embedded pane: the picture (`lead`), the title and one control. The title is a plain string and the `<bdi>` inside
 * the heading cuts at its end, as in the Inbox. A pane that still loads has no title: the head then holds the control only.
 */
export function EmbeddedHeader({ embedded, lead, title }: { embedded: EmbeddedChat; lead: ReactNode; title: string }) {
  const { page, label, onClose, below } = embedded;
  return (
    <>
    <header className={`flex shrink-0 items-center gap-2 border-b border-hairline px-2 ${page ? 'h-[calc(56px+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]' : 'h-14'}`}>
      {page && (
        <button type="button" aria-label={label} onClick={onClose} className={ROUND}>
          <AnimatedIcon icon={ChevronLeftIcon} size={22} className="rtl:-scale-x-100" aria-hidden />
        </button>
      )}
      {lead && <span className="ms-1 shrink-0">{lead}</span>}
      <h2 className="min-w-0 flex-1 text-headline text-ink"><bdi className="block truncate">{title}</bdi></h2>
      {!page && (
        <button type="button" aria-label={label} onClick={onClose} className={ROUND}>
          <AnimatedIcon icon={XIcon} size={18} aria-hidden />
        </button>
      )}
    </header>
    {below}
    </>
  );
}
