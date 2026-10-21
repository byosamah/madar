import { motion } from 'motion/react';
import { memo, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateMove } from '../../api/contract/entities';
import type { Attachment, GroupLine, ReplyRef, UserCard } from '../../api/contract/views';
import { usePictureTest } from '../../app/files';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { AgentLabel } from '../../components/AgentLabel';
import { Avatar } from '../../components/Avatar';
import { RichText } from '../../components/RichText';
import { spring } from '../../design/motion';
import { clockFormat, listFormat, type Lang } from '../../lib/dates';
import { actorContext } from '../../lib/grammar';
import { reasonLineText, type ReasonKind } from '../comments/ReasonLine';
import { AttachmentList, photoOnlyBody } from '../files/PictureAttachments';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { BadgeAlertIcon } from '../../components/icons/animated/badge-alert';
import { DateMoveLines } from '../project/tasks/DateReason';
import { EditingContext, useBubbleActions } from './bubbleActions';
import { useLongPress } from './longPress';
import { MessageEditForm } from './MessageEditForm';
import { MessageSheet, MessageTools } from './MessageMenu';
import { ReactionPills } from './ReactionPills';
import { BubbleReplyQuote } from './ReplyStrip';

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
  /** True when the message names the reader (an @mention, or a reply to the reader). Another person's bubble then gets the names-you mark (item 4). */
  namesMe?: boolean;
  /** The people behind each reaction (chat design item 12). Missing means none. */
  reactions?: Record<string, string[]>;
  /**
   * A message of the person that the server has not saved (instant send, item 13): faded while it goes, and with "Not sent" and "Send again"
   * when it failed. It has no menu, no pills and no sheet. Missing: a saved message.
   */
  status?: 'pending' | 'failed';
  /** True on the saved message that took the place of a faded copy: it skips its rise, so the swap shows no second motion. */
  fromOutbox?: true;
  /** True when the reader may edit and delete this bubble: the author of a message or of a comment (item 11). */
  canEdit?: boolean;
  /** The message or comment that this one answers (item 10). Null or missing: it answers nothing. */
  replyTo?: ReplyRef | null;
  /** A quiet line of a group (a person joined or left, a new name). It is no message: the log draws it as one grey line. */
  line?: GroupLine;
  /** A quiet line of a task thread (fbk_027): the reason of a date move or of a reopening, or a Madar shift. The log draws one grey line. */
  reason?: { kind: ReasonKind; dates?: DateMove };
};

/** The soft frame of the message that the log opened at (item 10): the closest `li` takes it for one second. */
export const FRAME_CLASS = 'rounded-2xl outline outline-2 outline-offset-2 outline-link/40';

/** The word key of each kind of quiet line. */
const LINE_KEY = { added: 'chat.lineAdded', removed: 'chat.lineRemoved', left: 'chat.lineLeft', renamed: 'chat.lineRenamed' } as const;

/**
 * One quiet line of a group, in the screen language: "Hala added Yousef". Each name sits between FSI and PDI, so an English name in an
 * Arabic line keeps its own direction (UX audit 2026-10-19, chats-10).
 */
function GroupLineItem({ id, line, framed }: { id: string; line: GroupLine; framed: boolean }) {
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
  return <li data-message-id={id} data-framed={framed || undefined} className={`group mt-1.5 self-center px-3 py-0.5 text-center text-footnote text-ink-2 ${framed ? FRAME_CLASS : ''}`}>{text}</li>;
}

/**
 * The reason of a date move or of a reopening in a task thread (fbk_027, owner 2026-10-19): "Faisal changed the due date: <reason>" as one
 * grey line between the messages, as a group line is. It is no message: no bubble, no sender above it, no clock. The moved dates come
 * under it in a smaller size.
 */
function ReasonLineItem({ bubble, reason, framed }: { bubble: Bubble; reason: NonNullable<Bubble['reason']>; framed: boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const text = reasonLineText(t, { kind: reason.kind, body: bubble.body, dates: reason.dates }, { name: nameOf(bubble.author), gender: bubble.author.gender });
  return (
    <li data-message-id={bubble.id} data-framed={framed || undefined} className={`group mt-1.5 flex flex-col items-center self-center px-3 py-0.5 text-center text-footnote text-ink-2 ${framed ? FRAME_CLASS : ''}`}>
      <span dir="auto">{text}</span>
      {reason.dates && <DateMoveLines move={reason.dates} className="items-center text-caption text-label-2" />}
    </li>
  );
}

export function clockTime(stamp: string, lang: Lang): string {
  return clockFormat(lang).format(new Date(stamp));
}

/**
 * Memoized, so a send, a reload or a chat switch renders again only the bubbles that changed (performance audit 2026-10-07,
 * RND-5). The panes keep one Bubble object for each message (bubblesOf), so an unchanged message keeps its props. `runStart` is a
 * boolean, so the memo holds: only the first bubble of a run shows the face, the name and the clock (design item 2).
 */
export const MessageBubble = memo(function MessageBubble({ bubble, fresh, runStart, namesMe, framed }: { bubble: Bubble; fresh: boolean; runStart: boolean; namesMe: boolean; framed: boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const lang = useLang();
  const isPicture = usePictureTest();
  const actions = useBubbleActions();
  const editing = useContext(EditingContext) === bubble.id;
  // A long press of a finger opens the sheet of the message (item 9). The sheet is a sibling of the row, so its events never reach the row.
  const [sheet, setSheet] = useState(false);
  const press = useLongPress(() => setSheet(true));
  const { author, mine } = bubble;
  const saved = bubble.status === undefined;
  if (bubble.line) return <GroupLineItem id={bubble.id} line={bubble.line} framed={framed} />;
  if (bubble.reason) return <ReasonLineItem bubble={bubble} reason={bubble.reason} framed={framed} />;
  // A photo sent with no words has its file name as its words. Beside the preview that name is noise, so the bubble leaves it out.
  const photoOnly = photoOnlyBody(bubble.body, bubble.files, isPicture);
  // The names-you mark is for another person's bubble: your own bubble keeps its blue (item 4).
  const marked = namesMe && !mine;
  // The side spot sits beside the bubble: at its end side for another person, at its start side for your own. It holds the "..." button
  // (item 9), and a next message of a run keeps its time here at opacity 0 until hover or focus (opacity, not visibility, so a screen
  // reader still reads it). The time sits next to the bubble, the button outside it.
  const time = !runStart && (
    <time dateTime={bubble.createdAt} className="tabular text-caption text-ink-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
      {clockTime(bubble.createdAt, lang)}
    </time>
  );
  const tools = saved && <MessageTools bubble={bubble} />;
  const side = <div data-part="side" className="flex items-center gap-1.5 self-center">{mine ? <>{tools}{time}</> : <>{time}{tools}</>}</div>;
  return (
    <>
      <motion.li
        data-message-id={bubble.id}
        data-framed={framed || undefined}
        aria-busy={bubble.status === 'pending' ? true : undefined}
        {...(actions && saved && !actions.inSheet ? press : {})}
        initial={fresh && !bubble.fromOutbox ? { opacity: 0, y: 12 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.standard}
        className={`group flex max-w-[88%] items-end gap-2 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] sm:max-w-[75%] ${mine ? 'self-end' : 'self-start'} ${runStart ? 'mt-1.5' : ''} ${framed ? FRAME_CLASS : ''}`}
      >
        {mine && side}
        {!mine && (runStart ? <Avatar user={author} size={28} /> : <span aria-hidden className="w-7 shrink-0" />)}
        <div className="flex min-w-0 flex-col gap-0.5">
          {runStart && (!mine || author.kind === 'agent') && (
            <p className="flex flex-wrap items-center gap-x-2 px-1 text-footnote text-ink-2">
              {!mine && <bdi className="font-semibold text-ink">{nameOf(author)}</bdi>}
              {author.kind === 'agent' && <AgentLabel />}
              {bubble.actingFor && <span>{t('chat.actingFor', { name: nameOf(bubble.actingFor) })}</span>}
            </p>
          )}
          <div
            style={mine ? { background: 'var(--p-blue-bg)' } : undefined}
            className={`rounded-2xl px-3 py-2 text-ink ${mine ? 'rounded-ee-md' : `rounded-es-md ${marked ? 'relative ps-4 bg-mention-bg' : 'bg-fill'}`} ${runStart ? '' : mine ? 'rounded-se-md' : 'rounded-ss-md'} ${saved ? '' : 'opacity-60'}`}
          >
            {marked && <span aria-hidden className="absolute inset-y-2 start-1.5 w-[3px] rounded-full bg-mention-bar" />}
            {marked && <span className="sr-only">{t('chat.namesYou')}</span>}
            {bubble.replyTo && <BubbleReplyQuote replyTo={bubble.replyTo} />}
            {editing ? <MessageEditForm bubble={bubble} /> : !photoOnly && <RichText body={bubble.body} className="natural-side text-subheadline" />}
            <AttachmentList files={bubble.files} />
            {(runStart || bubble.edited) && (
              <p className="tabular pt-0.5 text-end text-caption text-ink-2">
                {runStart && <time dateTime={bubble.createdAt}>{clockTime(bubble.createdAt, lang)}</time>}
                {bubble.edited && `${runStart ? ' · ' : ''}${t('comments.edited')}`}
              </p>
            )}
          </div>
          {saved && <ReactionPills bubble={bubble} />}
          {bubble.status === 'failed' && (
            <div className="flex items-center justify-end gap-1 px-1 text-footnote">
              <span className="inline-flex items-center gap-1 font-medium text-late">
                <AnimatedIcon icon={BadgeAlertIcon} size={14} aria-hidden />
                <span>{t('chat.notSent')}</span>
              </span>
              <span aria-hidden className="text-ink-2">·</span>
              <button type="button" onClick={() => actions?.retry(bubble)} className="pressable min-h-11 rounded-full px-2 font-medium text-link hover:bg-fill">
                {t('chat.sendAgain')}
              </button>
            </div>
          )}
        </div>
        {!mine && side}
      </motion.li>
      {sheet && actions && <MessageSheet bubble={bubble} open onOpenChange={setSheet} />}
    </>
  );
});
