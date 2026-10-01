import { motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Attachment, UserCard } from '../../api/contract/views';
import { newStoryId } from '../../app/actions';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useToast } from '../../app/toasts';
import { AgentLabel } from '../../components/AgentLabel';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { MentionField } from '../../components/MentionField';
import { RichText } from '../../components/RichText';
import { spring } from '../../design/motion';
import { addDays, formatDay, localeFor, OFFICE_TZ, stampDay, todayISO, type Lang } from '../../lib/dates';
import { groupByDay } from '../../lib/group';
import { withMentionMarkup } from '../../lib/text';
import { AttachButton, FileChips, PickedFiles, useAttachments, type UploadTarget } from '../files/Attachments';

/** One bubble. A chat message and a task comment both turn into this. */
export type Bubble = {
  id: string;
  author: UserCard;
  /** The person an agent acted for. */
  actingFor: UserCard | null;
  body: string;
  files: Attachment[];
  createdAt: string;
  mine: boolean;
  edited: boolean;
};

export function clockTime(stamp: string, lang: Lang): string {
  return new Intl.DateTimeFormat(localeFor(lang), { hour: 'numeric', minute: '2-digit', timeZone: OFFICE_TZ }).format(new Date(stamp));
}

function BubbleItem({ bubble, fresh }: { bubble: Bubble; fresh: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { author, mine } = bubble;
  return (
    <motion.li
      initial={fresh ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.standard}
      className={`flex max-w-[88%] items-end gap-2 sm:max-w-[75%] ${mine ? 'self-end' : 'self-start'}`}
    >
      {!mine && <Avatar user={author} size={28} />}
      <div className="flex min-w-0 flex-col gap-0.5">
        {(!mine || author.kind === 'agent') && (
          <p className="flex flex-wrap items-center gap-x-2 px-1 text-footnote text-ink-2">
            {!mine && <bdi className="font-semibold text-ink">{author.name}</bdi>}
            {author.kind === 'agent' && <AgentLabel />}
            {bubble.actingFor && <span>{t('chat.actingFor', { name: bubble.actingFor.name })}</span>}
          </p>
        )}
        <div
          style={mine ? { background: 'var(--p-blue-bg)' } : undefined}
          className={`rounded-2xl px-3 py-2 text-ink ${mine ? 'rounded-ee-md' : 'rounded-es-md bg-fill'}`}
        >
          <RichText body={bubble.body} className="text-subheadline" />
          <FileChips files={bubble.files} />
          <p className="tabular pt-0.5 text-end text-caption text-ink-2">
            <time dateTime={bubble.createdAt}>{clockTime(bubble.createdAt, lang)}</time>
            {bubble.edited && ` · ${t('comments.edited')}`}
          </p>
        </div>
      </div>
    </motion.li>
  );
}

/** The messages by day. The region scrolls to the bottom when a message arrives. New messages rise in. */
export function MessageLog({ bubbles, resetKey, emptyText }: { bubbles: Bubble[]; resetKey: string; emptyText: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const region = useRef<HTMLDivElement>(null);
  // The messages that are here when the log first shows do not animate. A message that comes later does.
  const [first] = useState(() => new Set(bubbles.map((b) => b.id)));
  useLayoutEffect(() => {
    if (region.current) region.current.scrollTop = region.current.scrollHeight;
  }, [bubbles.length, resetKey]);
  const today = todayISO();
  const dayLabel = (day: string) => (day === today ? t('inbox.today') : day === addDays(today, -1) ? t('inbox.yesterday') : formatDay(day, lang, 'long'));
  return (
    <div ref={region} role="log" aria-label={t('chat.messages')} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
      {bubbles.length === 0 && <p className="text-subheadline text-ink-2">{emptyText}</p>}
      <ol className="flex flex-col gap-2">
        {groupByDay(bubbles, (b) => stampDay(b.createdAt)).flatMap((group) => [
          <li key={`day-${group.day}`} className="self-center py-2 text-footnote font-semibold text-ink-2">{dayLabel(group.day)}</li>,
          ...group.items.map((bubble) => <BubbleItem key={bubble.id} bubble={bubble} fresh={!first.has(bubble.id)} />),
        ])}
      </ol>
    </div>
  );
}

/** The box under the messages. Enter sends, Shift+Enter starts a new line, and the focus lands here when a chat opens. */
export function Composer({
  id, people, pending, onSend, upload,
}: {
  id: string;
  people: UserCard[];
  pending: boolean;
  /** "clear" empties the box. Call it when the send worked. */
  onSend: (body: string, fileIds: string[], clear: () => void) => void;
  /** Where picked files go. A chat with no project of its own has none, so it shows no attach control. */
  upload?: UploadTarget;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const attachments = useAttachments();
  const [uploading, setUploading] = useState(false);
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, [id]);
  const submit = async () => {
    const body = withMentionMarkup(text.trim(), people);
    if (!body || pending || uploading) return;
    let fileIds: string[] = [];
    if (upload && attachments.files.length > 0) {
      setUploading(true);
      try {
        fileIds = await attachments.upload(upload, { correlationId: newStoryId() });
      } catch (error) {
        toast.show({ tone: 'error', message: errorMessage(error, t) });
        return;
      } finally {
        setUploading(false);
      }
    }
    onSend(body, fileIds, () => {
      setText('');
      attachments.clear();
      field.current?.focus();
    });
  };
  return (
    <form
      className="flex flex-col gap-2 border-t border-hairline p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {upload && <PickedFiles files={attachments.files} onRemove={attachments.remove} />}
      <div className="flex items-end gap-2">
      {upload && <AttachButton compact onPick={attachments.add} />}
      <div
        className="min-w-0 flex-1"
        onKeyDown={(event) => {
          // The mention list handles its own Enter and marks the event. Only a plain Enter sends.
          if (event.key !== 'Enter' || event.shiftKey || event.defaultPrevented || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void submit();
        }}
      >
        <MentionField
          id={`composer-${id}`}
          label={t('chat.composer')}
          value={text}
          onChange={setText}
          people={people}
          rows={1}
          inputRef={field}
          placeholder={t('chat.placeholder')}
          className="[&_textarea]:max-h-40 [&_textarea]:min-h-11 [&_textarea]:resize-none [&_textarea]:[field-sizing:content]"
        />
      </div>
      <Button variant="primary" type="submit" className="shrink-0" disabled={!text.trim() || pending || uploading}>{t('chat.send')}</Button>
      </div>
    </form>
  );
}
