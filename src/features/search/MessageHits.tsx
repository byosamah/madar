import { Command } from 'cmdk';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { Avatar } from '../../components/Avatar';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ClipboardCheckIcon } from '../../components/icons/animated/clipboard-check';
import { ProjectTile } from '../../components/ProjectTile';
import { formatDay, stampDay } from '../../lib/dates';
import { chatLink } from '../../lib/params';
import { shownKey } from '../../lib/projectLabel';
import { markedParts } from '../../lib/searchMatch';
import { GroupPicture } from '../inbox/GroupPicture';

type Hit = CallOutput<'search.query'>['messages'][number];

const PICTURE = 32;

/** The picture of the chat of a hit: the project, the other person, the group, or the task (an office task has the task circle). */
function Lead({ hit }: { hit: Hit }) {
  if (hit.project) return <ProjectTile id={hit.project.id} mark={hit.project.mark} size={PICTURE} />;
  if (hit.kind === 'direct' && hit.person) return <Avatar user={hit.person} size={PICTURE} />;
  if (hit.kind === 'group') return <GroupPicture id={hit.chatId} size={PICTURE} />;
  return (
    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-fill text-ink-2">
      <AnimatedIcon icon={ClipboardCheckIcon} size={16} aria-hidden />
    </span>
  );
}

/**
 * The Messages group of the Search screen (chat design 2026-10-19, item 16): the newest messages and task comments that hold every word
 * of the query. A hit shows the chat picture, the chat name, the person and the line with each matched word marked in grey, and the
 * date. A press opens the chat, or the Inbox task thread, at that message.
 */
export function MessageHits({ hits, words }: { hits: CallOutput<'search.query'>['messages']; words: readonly string[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const nameOf = usePersonName();
  const lang = useLang();
  if (hits.length === 0) return null;
  return (
    <Command.Group
      heading={t('search.messages')}
      className="flex flex-col [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-footnote [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-label-2"
    >
      {hits.map((hit) => {
        const name = hit.kind === 'direct' && hit.person ? nameOf(hit.person) : hit.title;
        const by = hit.mine ? t('chat.you') : nameOf(hit.author).split(' ')[0];
        // A task shows its project key beside its title, and an office task the word Office (as the Tasks group does).
        const key = hit.kind === 'task' ? (hit.project ? shownKey(hit.project.code, t) : t('office.word')) : null;
        return (
          <Command.Item
            key={hit.id}
            value={`message-${hit.id}`}
            onSelect={() => navigate(chatLink(hit.chatId, hit.id))}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-3 py-2 text-body data-[selected=true]:bg-fill"
          >
            <Lead hit={hit} />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="flex items-baseline gap-2">
                <bdi className="min-w-0 truncate text-body font-medium text-ink">{name}</bdi>
                {key && <span className="tabular shrink-0 text-footnote text-label-2">{key}</span>}
              </span>
              <span className="line-clamp-2 text-footnote text-label-2">
                <bdi className="me-1 font-semibold text-ink">{by}:</bdi>
                <span dir="auto" className="natural-side">
                  {markedParts(hit.line, words).map((part, index) =>
                    part.marked ? <mark key={index} className="rounded-sm bg-fill-strong text-ink">{part.text}</mark> : part.text)}
                </span>
              </span>
            </span>
            <time dateTime={hit.at} className="tabular shrink-0 pt-0.5 text-footnote text-label-2">{formatDay(stampDay(hit.at), lang)}</time>
          </Command.Item>
        );
      })}
    </Command.Group>
  );
}
