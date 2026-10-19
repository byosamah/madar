import { useTranslation } from 'react-i18next';
import type { ReplyRef } from '../../api/contract/views';
import { usePersonName } from '../../app/personName';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { CornerUpLeftIcon } from '../../components/icons/animated/corner-up-left';
import { XIcon } from '../../components/icons/animated/x';
import { firstLineOf } from '../../lib/text';
import type { Bubble } from './MessageBubble';

/**
 * The link that a reply to this bubble holds (chat design 2026-10-19, item 10). The person who gets named is the person behind an agent
 * message, as on the server. The server checks the link again and fills its own view.
 */
export function replyRefOfBubble(bubble: Bubble): ReplyRef {
  return { id: bubble.id, author: bubble.actingFor ?? bubble.author, firstLine: firstLineOf(bubble.body), deleted: false };
}

/**
 * The grey strip above the field of the box while a reply waits: the name of the author, the first line of the old message and an X
 * that drops the reply. Escape in the field does the same (Composer).
 */
export function ComposerReplyStrip({ replyTo, onCancel }: { replyTo: ReplyRef; onCancel: () => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  return (
    <div className="flex items-center gap-2 rounded-xl bg-fill py-1 ps-3 pe-1">
      <AnimatedIcon icon={CornerUpLeftIcon} size={16} className="shrink-0 text-ink-2 rtl:-scale-x-100" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <bdi className="truncate text-footnote font-medium text-ink">{t('chat.replyTo', { name: nameOf(replyTo.author) })}</bdi>
        <span dir="auto" className="truncate text-footnote text-ink-2">{replyTo.firstLine}</span>
      </div>
      <button
        type="button"
        aria-label={t('chat.cancelReply')}
        onClick={onCancel}
        className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink"
      >
        <AnimatedIcon icon={XIcon} size={16} aria-hidden />
      </button>
    </div>
  );
}

/**
 * The quote above the words of a reply, inside its bubble: the name and the first line of the old message, with a bar on the start side.
 * An old message that is gone shows "Deleted message" and nothing of its words. Plain text here; a later task makes it a button.
 */
export function BubbleReplyQuote({ replyTo }: { replyTo: ReplyRef }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  return (
    <div className="mb-1.5 flex w-full flex-col rounded-lg border-s-[3px] border-label-3 bg-fill-strong px-2.5 py-1 text-start">
      {replyTo.deleted ? (
        <span className="text-footnote text-ink-2">{t('chat.deletedMessage')}</span>
      ) : (
        <>
          <bdi className="truncate text-footnote font-medium text-ink">{nameOf(replyTo.author)}</bdi>
          <span dir="auto" className="truncate text-footnote text-ink-2">{replyTo.firstLine}</span>
        </>
      )}
    </div>
  );
}
