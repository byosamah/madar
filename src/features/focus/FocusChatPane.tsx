import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '../../components/SegmentedControl';
import { ChatPane, TaskPane } from '../inbox/ConversationPane';
import { PhoneChatPage } from '../inbox/PhoneChatPage';
import type { FocusChatTarget } from './focusChat';

const keepAsIs = () => undefined;

type Props = {
  target: FocusChatTarget;
  /** The chats of the to-do. Two of them (the project chat and the to-do thread) give a switch at the top (owner, 2026-10-25). */
  choices: FocusChatTarget[];
  onPick: (kind: FocusChatTarget['kind']) => void;
  page: boolean;
  onClose: () => void;
};

/**
 * The chat of Focus mode (fbk_059). This file is the lazy chunk: FocusMode loads it at the first press and never imports it
 * statically, so the log, the box and the sheets stay out of the Focus chunk (`firstLoadImports.test.ts`, `check-bundles.ts`).
 * It is the Inbox pane in its embedded form. `page`: a full page over Focus, above its layer (z-[36]; Focus is z-[35]). Otherwise
 * a docked sidebar on the end edge, full height. The pane reads and marks read only while it is mounted, so a closed panel sends
 * nothing, and only the chat that shows reads. A project to-do has two chats: a two-part switch at the top picks one.
 */
export function FocusChatPane({ target, choices, onPick, page, onClose }: Props) {
  const { t } = useTranslation();
  const labelOf = (kind: FocusChatTarget['kind']) => (kind === 'task' ? t('chat.taskThread') : t('project.chat'));
  const label = labelOf(target.kind);
  // The full page takes the focus when it opens: the column of Focus is inert under it, so Tab starts in the page.
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (page) section.current?.focus();
  }, [page]);
  const choice = choices.length > 1 ? (
    <div className="shrink-0 border-b border-hairline px-3 py-2">
      <SegmentedControl<FocusChatTarget['kind']>
        fill
        label={t('focus.chatKind')}
        value={target.kind}
        options={choices.map((option) => ({ value: option.kind, label: labelOf(option.kind) }))}
        onChange={onPick}
      />
    </div>
  ) : undefined;
  // The switch sits under the head of the pane (its title and Close), above the messages.
  const embedded = { page, label: page ? t('focus.backToFocus') : t('common.close'), onClose, below: choice };
  // A new chat is a new pane (its own reads, read marks and draft), so the key is the id.
  const pane = target.kind === 'task'
    ? <TaskPane key={target.id} id={target.id} focusFromRoute={null} onMarkUnread={keepAsIs} embedded={embedded} />
    : <ChatPane key={target.id} id={target.id} focusFromRoute={null} onMarkUnread={keepAsIs} embedded={embedded} />;
  if (page) {
    return (
      <PhoneChatPage conversationId={target.id} layer="z-[36]" inertWhileSheet={false}>
        <section ref={section} tabIndex={-1} data-focus-chat aria-label={label} className="flex min-h-0 flex-1 flex-col outline-none">{pane}</section>
      </PhoneChatPage>
    );
  }
  return (
    <aside data-focus-chat aria-label={label} className="fixed inset-y-0 end-0 z-10 flex w-[24rem] flex-col overflow-hidden border-s border-hairline bg-panel">
      {pane}
    </aside>
  );
}
