import { ListChecks } from 'lucide-react';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { SearchIcon } from '../../components/icons/animated/search';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { Age } from '../../components/Age';
import { Avatar } from '../../components/Avatar';
import { ProjectTile } from '../../components/ProjectTile';
import { normalizeForSearch } from '../../lib/text';

type Row = CallOutput<'chats.list'>[number];

function Lead({ row }: { row: Row }) {
  if (row.kind === 'project' && row.project) return <ProjectTile id={row.project.id} mark={row.project.mark} size={40} />;
  if (row.kind === 'direct' && row.person) return <Avatar user={row.person} size={40} />;
  return <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-ink-2"><ListChecks size={18} /></span>;
}

function ChatRowItem({ row, selected }: { row: Row; selected: boolean }) {
  const { t } = useTranslation();
  const by = row.previewMine ? t('chat.you') : row.previewAuthor?.name.split(' ')[0] ?? '';
  // A direct chat shows the other person's words without a name, unless the words are mine.
  const showBy = row.preview !== '' && by !== '' && (row.kind !== 'direct' || row.previewMine);
  return (
    <li>
      <Link
        to={`/inbox/${row.id}`}
        aria-current={selected ? 'page' : undefined}
        className={`pressable flex min-h-[4.25rem] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-fill/50 ${selected ? 'bg-fill' : ''}`}
      >
        <Lead row={row} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline justify-between gap-2">
            <bdi className={`min-w-0 truncate text-subheadline ${row.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{row.title}</bdi>
            <span className="shrink-0 text-footnote text-ink-2"><Age stamp={row.lastAt} /></span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span dir="auto" className={`min-w-0 truncate text-footnote ${row.unread > 0 ? 'text-ink' : 'text-ink-2'}`}>
              {showBy && <span>{by}: </span>}
              {row.preview}
            </span>
            {row.unread > 0 && (
              <span className="signature tabular inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-caption font-semibold">
                <span aria-hidden>{row.unread > 99 ? '99+' : row.unread}</span>
                <span className="sr-only">{t('chat.unread', { count: row.unread })}</span>
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The chats on the start side: a search field and one link for each project chat, direct chat and task thread. */
export function ChatList({ rows, selectedId }: { rows: Row[]; selectedId: string | undefined }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const needle = normalizeForSearch(query);
  const shown = needle === '' ? rows : rows.filter((row) => normalizeForSearch(`${row.title} ${row.project?.name ?? ''}`).includes(needle));
  return (
    <>
      <div className="relative p-3">
        <label htmlFor="chat-search" className="sr-only">{t('chat.search')}</label>
        <AnimatedIcon icon={SearchIcon} size={16} aria-hidden className="pointer-events-none absolute start-6 top-1/2 -translate-y-1/2 text-ink-2" />
        <input
          id="chat-search"
          type="search"
          dir="auto"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('chat.search')}
          className="min-h-11 w-full rounded-full bg-fill ps-9 pe-4 text-subheadline text-ink placeholder:text-ink-2"
        />
      </div>
      {shown.length === 0 && <p className="px-4 pb-4 text-subheadline text-ink-2">{t('chat.noMatch')}</p>}
      <ul aria-label={t('chat.list')} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {shown.map((row) => <ChatRowItem key={row.id} row={row} selected={row.id === selectedId} />)}
      </ul>
    </>
  );
}
