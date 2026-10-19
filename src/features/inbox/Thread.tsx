import { motion } from 'motion/react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MAX_ATTACHMENTS, MESSAGE_MAX } from '../../api/contract/entities';
import { useTranslation } from 'react-i18next';
import type { Attachment, GroupLine, UserCard } from '../../api/contract/views';
import { newStoryId } from '../../app/actions';
import { readDraftFiles, useDraftOwner, useDraftText, writeDraftFiles } from '../../app/drafts';
import { usePictureTest } from '../../app/files';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useToast } from '../../app/toasts';
import { AgentLabel } from '../../components/AgentLabel';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { MentionField } from '../../components/MentionField';
import { RichText } from '../../components/RichText';
import { spring } from '../../design/motion';
import { addDays, clockFormat, formatDay, listFormat, stampDay, todayISO, type Lang } from '../../lib/dates';
import { actorContext } from '../../lib/grammar';
import { groupByDay } from '../../lib/group';
import { withMentionMarkup } from '../../lib/text';
import { AttachButton, PickedFiles, useAttachments, type UploadTarget } from '../files/Attachments';
import { AttachmentList, photoOnlyBody } from '../files/PictureAttachments';

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
  /** A quiet line of a group (a person joined or left, a new name). It is no message: the log draws it as one grey line. */
  line?: GroupLine;
};

/** The word key of each kind of quiet line. */
const LINE_KEY = { added: 'chat.lineAdded', removed: 'chat.lineRemoved', left: 'chat.lineLeft', renamed: 'chat.lineRenamed' } as const;

/**
 * One quiet line of a group, in the screen language: "Hala added Yousef". Each name sits between FSI and PDI, so an English name in an
 * Arabic line keeps its own direction (UX audit 2026-10-19, chats-10).
 */
function GroupLineItem({ line }: { line: GroupLine }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const lang = useLang();
  const isolate = (name: string) => `\u2068${name}\u2069`;
  const text = t(LINE_KEY[line.type], {
    actor: isolate(nameOf(line.actor)),
    people: listFormat(lang).format(line.people.map((person) => isolate(nameOf(person)))),
    name: isolate(line.name ?? ''),
    context: actorContext(line.actor),
  });
  return <li className="self-center px-3 py-0.5 text-center text-footnote text-ink-2">{text}</li>;
}

export function clockTime(stamp: string, lang: Lang): string {
  return clockFormat(lang).format(new Date(stamp));
}

/**
 * Memoized, so a send, a reload or a chat switch renders again only the bubbles that changed (performance audit 2026-10-07,
 * RND-5). The panes keep one Bubble object for each message (bubblesOf), so an unchanged message keeps its props.
 */
const BubbleItem = memo(function BubbleItem({ bubble, fresh }: { bubble: Bubble; fresh: boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const lang = useLang();
  const isPicture = usePictureTest();
  const { author, mine } = bubble;
  if (bubble.line) return <GroupLineItem line={bubble.line} />;
  // A photo sent with no words has its file name as its words. Beside the preview that name is noise, so the bubble leaves it out.
  const photoOnly = photoOnlyBody(bubble.body, bubble.files, isPicture);
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
            {!mine && <bdi className="font-semibold text-ink">{nameOf(author)}</bdi>}
            {author.kind === 'agent' && <AgentLabel />}
            {bubble.actingFor && <span>{t('chat.actingFor', { name: nameOf(bubble.actingFor) })}</span>}
          </p>
        )}
        <div
          style={mine ? { background: 'var(--p-blue-bg)' } : undefined}
          className={`rounded-2xl px-3 py-2 text-ink ${mine ? 'rounded-ee-md' : 'rounded-es-md bg-fill'}`}
        >
          {!photoOnly && <RichText body={bubble.body} className="natural-side text-subheadline" />}
          <AttachmentList files={bubble.files} />
          <p className="tabular pt-0.5 text-end text-caption text-ink-2">
            <time dateTime={bubble.createdAt}>{clockTime(bubble.createdAt, lang)}</time>
            {bubble.edited && ` · ${t('comments.edited')}`}
          </p>
        </div>
      </div>
    </motion.li>
  );
});

/** The control for the earlier messages of a chat: absent when the chat has none left to show. */
export type EarlierControl = {
  /** True when a page arrived, false when it did not (the error shows as a toast). */
  load: () => Promise<boolean>;
  pending: boolean;
};

/**
 * The messages by day. The region scrolls to the bottom when a message arrives. New messages rise in. With `earlier`, the top of
 * the log has an "Earlier messages" control; its page goes above the shown messages, and the scroll keeps its distance from the
 * bottom, so the message the person reads stays in place.
 */
export function MessageLog({ bubbles, resetKey, emptyText, earlier }: { bubbles: Bubble[]; resetKey: string; emptyText: string; earlier?: EarlierControl }) {
  const { t } = useTranslation();
  const lang = useLang();
  const region = useRef<HTMLDivElement>(null);
  const items = useRef<HTMLOListElement>(null);
  // True while the person reads the newest messages (the log is at its bottom, within 80 px). A picture grows its box when it has loaded,
  // and the log then keeps the bottom in view. A person who reads old messages is not moved.
  const atBottom = useRef(true);
  // The distance from the bottom when the person asked for earlier messages, and whether the focus was on that control.
  const anchor = useRef<{ fromBottom: number; focused: boolean; firstId: string | undefined } | null>(null);
  // The messages that are here when the log first shows do not animate. A message newer than all of them does. An earlier page
  // is older, so it shows at once: 200 bubbles that rise in together above the one the person reads are not calm.
  const [first] = useState(() => new Set(bubbles.map((b) => b.id)));
  const [newestAtFirst] = useState(() => Math.max(-Infinity, ...bubbles.map((b) => Date.parse(b.createdAt))));
  const firstId = bubbles[0]?.id;
  const lastId = bubbles.at(-1)?.id;
  useLayoutEffect(() => {
    if (region.current) region.current.scrollTop = region.current.scrollHeight;
    atBottom.current = true;
  }, [lastId, resetKey]);
  useEffect(() => {
    const log = region.current;
    const list = items.current;
    if (!log || !list || typeof ResizeObserver === 'undefined') return undefined;
    const watcher = new ResizeObserver(() => {
      if (atBottom.current && !anchor.current) log.scrollTop = log.scrollHeight;
    });
    watcher.observe(list);
    return () => watcher.disconnect();
  }, []);
  const hasEarlier = earlier !== undefined;
  useLayoutEffect(() => {
    const log = region.current;
    const kept = anchor.current;
    // Only the arrival of the page counts: a new oldest message, or the control gone after an empty last page.
    if (!log || !kept || (firstId === kept.firstId && hasEarlier)) return;
    log.scrollTop = log.scrollHeight - kept.fromBottom;
    // The control goes after the first page of the chat. The focus then stays in the log, not on the page body.
    if (!hasEarlier && kept.focused) log.focus({ preventScroll: true });
    anchor.current = null;
  }, [firstId, hasEarlier]);
  const askEarlier = (control: EarlierControl, button: HTMLButtonElement) => {
    if (control.pending || !region.current) return;
    anchor.current = { fromBottom: region.current.scrollHeight - region.current.scrollTop, focused: document.activeElement === button, firstId };
    // A page that does not arrive moves nothing, so the kept distance goes. Else the next new message scrolls back to it.
    void control.load().then((loaded) => {
      if (!loaded) anchor.current = null;
    });
  };
  const today = todayISO();
  const dayLabel = (day: string) => (day === today ? t('inbox.today') : day === addDays(today, -1) ? t('inbox.yesterday') : formatDay(day, lang, 'long'));
  return (
    <div
      ref={region}
      role="log"
      tabIndex={-1}
      aria-label={t('chat.messages')}
      onScroll={(event) => {
        const log = event.currentTarget;
        atBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 outline-none [overflow-anchor:none] sm:px-5"
    >
      {earlier && (
        <div className="flex justify-center pb-2">
          {/* aria-disabled, not disabled: a disabled button drops the focus while the page loads. */}
          <Button variant="plain" aria-disabled={earlier.pending} aria-busy={earlier.pending} className={earlier.pending ? 'opacity-60' : ''} onClick={(event) => askEarlier(earlier, event.currentTarget)}>
            {t('chat.earlier')}
          </Button>
        </div>
      )}
      {bubbles.length === 0 && <p className="text-subheadline text-ink-2">{emptyText}</p>}
      <ol ref={items} className="flex flex-col gap-2">
        {groupByDay(bubbles, (b) => stampDay(b.createdAt)).flatMap((group) => [
          <li key={`day-${group.day}`} className="self-center py-2 text-footnote font-semibold text-ink-2">{dayLabel(group.day)}</li>,
          ...group.items.map((bubble) => <BubbleItem key={bubble.id} bubble={bubble} fresh={!first.has(bubble.id) && Date.parse(bubble.createdAt) > newestAtFirst} />),
        ])}
      </ol>
    </div>
  );
}

type ComposerProps = {
  id: string;
  people: UserCard[];
  pending: boolean;
  /** "clear" empties the box. Call it when the send worked. */
  onSend: (body: string, fileIds: string[], clear: () => void) => void;
  /** Where picked files go: a project, an office task or a chat of its own. Without it, the box shows no attach control. */
  upload?: UploadTarget;
};

/**
 * The box under the messages, for the current person. A change of person starts a new box with that person's draft, so no
 * typed words or picked files go over to the next person (audit 2026-10-03, V-22).
 */
export function Composer(props: ComposerProps) {
  const owner = useDraftOwner();
  return owner ? <ComposerBox key={owner} owner={owner} {...props} /> : null;
}

/**
 * Enter sends, Shift+Enter starts a new line, and the focus lands here when a chat opens. Opening another chat, another tab or
 * Search unmounts the box; its draft waits until the person comes back or sends it (audit 2026-10-03, SHL-4). The text uses the
 * keys of the comment box (CommentThread), so a task thread and the comments of its task share one draft.
 */
function ComposerBox({ id, people, pending, onSend, upload, owner }: ComposerProps & { owner: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const draftKey = id.startsWith('tsk_') ? `task:${id}` : `chat:${id}`;
  const attachments = useAttachments(MAX_ATTACHMENTS, readDraftFiles(owner, draftKey));
  const [uploading, setUploading] = useState(false);
  const [text, setText] = useDraftText(owner, draftKey);
  useEffect(() => {
    writeDraftFiles(owner, draftKey, attachments.files);
  }, [owner, draftKey, attachments.files]);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, [id]);
  // A file may go with no words: its name becomes the words, the same way Share does (audit 2026-10-03, SHL-21).
  const files = upload ? attachments.files : [];
  const submit = async () => {
    const body = withMentionMarkup(text.trim(), people) || files.map((file) => file.name).join(', ').slice(0, MESSAGE_MAX);
    if (!body || pending || uploading) return;
    let fileIds: string[] = [];
    if (upload && attachments.files.length > 0) {
      setUploading(true);
      try {
        fileIds = await attachments.upload(upload, { correlationId: newStoryId() });
      } catch (error) {
        toast.failed(error);
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
          placement="above"
          placeholder={t('chat.placeholder')}
          className="[&_textarea]:max-h-40 [&_textarea]:min-h-11 [&_textarea]:resize-none [&_textarea]:[field-sizing:content]"
        />
      </div>
      <Button variant="primary" type="submit" className="shrink-0" disabled={(!text.trim() && files.length === 0) || pending || uploading}>{t('chat.send')}</Button>
      </div>
    </form>
  );
}
