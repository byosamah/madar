import { motion } from 'motion/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateMove } from '../../api/contract/entities';
import type { Attachment, GroupLine, UserCard } from '../../api/contract/views';
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
import { DateMoveLines } from '../project/tasks/DateReason';

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
  /** A quiet line of a task thread (fbk_027): the reason of a date move or of a reopening, or a Madar shift. The log draws one grey line. */
  reason?: { kind: ReasonKind; dates?: DateMove };
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

/**
 * The reason of a date move or of a reopening in a task thread (fbk_027, owner 2026-10-19): "Faisal changed the due date: <reason>" as one
 * grey line between the messages, as a group line is. It is no message: no bubble, no sender above it, no clock. The moved dates come
 * under it in a smaller size.
 */
function ReasonLineItem({ bubble, reason }: { bubble: Bubble; reason: NonNullable<Bubble['reason']> }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const text = reasonLineText(t, { kind: reason.kind, body: bubble.body, dates: reason.dates }, { name: nameOf(bubble.author), gender: bubble.author.gender });
  return (
    <li className="flex flex-col items-center self-center px-3 py-0.5 text-center text-footnote text-ink-2">
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
 * RND-5). The panes keep one Bubble object for each message (bubblesOf), so an unchanged message keeps its props.
 */
export const MessageBubble = memo(function MessageBubble({ bubble, fresh }: { bubble: Bubble; fresh: boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const lang = useLang();
  const isPicture = usePictureTest();
  const { author, mine } = bubble;
  if (bubble.line) return <GroupLineItem line={bubble.line} />;
  if (bubble.reason) return <ReasonLineItem bubble={bubble} reason={bubble.reason} />;
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
