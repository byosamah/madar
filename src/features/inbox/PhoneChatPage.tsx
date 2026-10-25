import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useSheetToasts } from '../../app/toasts';
import { useVisualViewport } from '../../app/useVisualViewport';
import { spring } from '../../design/motion';

/**
 * The root of an open chat on a phone (Direction D). It is a full-screen page in a portal on the body, for two reasons: `.app-page`
 * gets a transform when a sheet opens, and a `fixed` child inside it would move; and the sheets (z-40 and z-50) and the toasts (z-80)
 * must stay above it (z-30). The height and the top follow `visualViewport`, so the message box stays above the keyboard of Safari for
 * iPhone. Where the API is absent the page takes `100dvh`. `--chat-h` holds the same height for the parts inside (the message box and
 * the @ list). The toast lane moves to the top while the page is open, so Undo stays in reach with the keyboard open.
 *
 * Focus mode (fbk_059) opens the same page over its own dialog. `layer` is then the class of a layer above Focus (z-[36]; Focus is
 * z-[35], the sheets z-40 and z-50), and `inertWhileSheet` is false: Focus itself sets the mark of an open panel on `<html>`, which
 * would make the page dead. A sheet over the page holds the focus by its own dialog.
 */
export function PhoneChatPage({ conversationId, layer = 'z-30', inertWhileSheet = true, children }: { conversationId: string; layer?: string; inertWhileSheet?: boolean; children: ReactNode }) {
  const viewport = useVisualViewport();
  const root = useRef<HTMLDivElement>(null);
  useSheetToasts(true);
  useInertWhileSheet(root, inertWhileSheet);
  const rtl = document.documentElement.dir === 'rtl';
  const height = viewport ? `${viewport.height}px` : '100dvh';
  return createPortal(
    // The key is the id of the chat only. A new `?at=` mark opens the same page and does not play the entrance again.
    <motion.div
      key={conversationId}
      ref={root}
      data-chat-page=""
      initial={{ opacity: 0, x: rtl ? -48 : 48 }}
      animate={{ opacity: 1, x: 0 }}
      transition={spring.standard}
      className={`fixed inset-x-0 ${layer} flex flex-col overflow-hidden overscroll-none bg-bg text-ink`}
      style={{ top: viewport ? viewport.offsetTop : 0, height, ['--chat-h' as string]: height }}
    >
      {children}
    </motion.div>,
    document.body,
  );
}

/**
 * While a sheet is open over the chat page, the page takes no focus and leaves the accessibility tree. `usePanelOpen` makes only
 * `.app-page` inert, and this page sits outside it, so it follows the same mark on the root element.
 */
function useInertWhileSheet(root: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return undefined;
    const html = document.documentElement;
    const sync = () => {
      element.inert = html.hasAttribute('data-panel-open');
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(html, { attributes: true, attributeFilter: ['data-panel-open'] });
    return () => {
      observer.disconnect();
      element.inert = false;
    };
  }, [root, enabled]);
}
