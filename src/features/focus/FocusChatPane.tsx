import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatPane, TaskPane } from '../inbox/ConversationPane';
import { PhoneChatPage } from '../inbox/PhoneChatPage';
import type { FocusChatTarget } from './focusChat';

const keepAsIs = () => undefined;

/**
 * The chat of Focus mode (fbk_059). This file is the lazy chunk: FocusMode loads it at the first press and never imports it
 * statically, so the log, the box and the sheets stay out of the Focus chunk (`firstLoadImports.test.ts`, `check-bundles.ts`).
 * It is the Inbox pane in its embedded form. `page`: a full page over Focus, above its layer (z-[36]; Focus is z-[35]). Otherwise
 * a panel on the end side, full height. The pane reads and marks read only while it is mounted, so a closed panel sends nothing.
 */
export function FocusChatPane({ target, page, onClose }: { target: FocusChatTarget; page: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const label = target.kind === 'task' ? t('chat.taskThread') : t('project.chat');
  const embedded = { page, label: page ? t('focus.backToFocus') : t('common.close'), onClose };
  // The full page takes the focus when it opens: the column of Focus is inert under it, so Tab starts in the page.
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (page) section.current?.focus();
  }, [page]);
  const pane = target.kind === 'task'
    ? <TaskPane id={target.id} focusFromRoute={null} onMarkUnread={keepAsIs} embedded={embedded} />
    : <ChatPane id={target.id} focusFromRoute={null} onMarkUnread={keepAsIs} embedded={embedded} />;
  if (page) {
    return (
      <PhoneChatPage conversationId={target.id} layer="z-[36]" inertWhileSheet={false}>
        <section ref={section} tabIndex={-1} data-focus-chat aria-label={label} className="flex min-h-0 flex-1 flex-col outline-none">{pane}</section>
      </PhoneChatPage>
    );
  }
  return (
    <aside data-focus-chat aria-label={label} className="panel fixed inset-y-3 end-3 z-10 flex w-[24rem] flex-col overflow-hidden">
      {pane}
    </aside>
  );
}
