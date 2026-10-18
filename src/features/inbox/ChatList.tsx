import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { SearchIcon } from '../../components/icons/animated/search';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { Age, AgeRefresh } from '../../components/Age';
import { Avatar } from '../../components/Avatar';
import { ProjectTile } from '../../components/ProjectTile';
import { normalizeForSearch } from '../../lib/text';
import { usePersonName } from '../../app/personName';
import { useAction } from '../../app/runtime';
import { Menu } from '../../components/Menu';
import { ClipboardCheckIcon } from '../../components/icons/animated/clipboard-check';

type Row = CallOutput<'chats.list'>[number];

function Lead({ row }: { row: Row }) {
  if (row.kind === 'project' && row.project) return <ProjectTile id={row.project.id} mark={row.project.mark} size={40} />;
  if (row.kind === 'direct' && row.person) return <Avatar user={row.person} size={40} />;
  return <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-ink-2"><AnimatedIcon icon={ClipboardCheckIcon} size={18} aria-hidden /></span>;
}

/** The title of a row: a direct chat shows the other person's name in the screen language (owner item 12). */
function useTitleOf(): (row: Row) => string {
  const nameOf = usePersonName();
  return (row) => (row.kind === 'direct' && row.person ? nameOf(row.person) : row.title);
}

/**
 * The menu of a chat, in its row and in its header: Archive, or Move back to Inbox in the archived list (owner, 2026-10-18).
 * Only the person sees it: an agent never archives a chat (the MCP deny list).
 */
export function ArchiveMenu({ id, archived }: { id: string; archived: boolean }) {
  const { t } = useTranslation();
  const archive = useAction('chats.archive');
  return (
    <Menu
      label={t('chat.options')}
      items={[{ label: archived ? t('chat.moveBack') : t('chat.archive'), onSelect: () => archive.mutate({ conversationId: id, archived: !archived }) }]}
    />
  );
}

/**
 * Memoized, so a chat switch, a send or a key in the search renders again only the rows whose data or selection changed
 * (performance audit 2026-10-07, RND-5). A row keeps its object across reloads (structural sharing), and its age refreshes
 * through AgeRefresh.
 */
const ChatRowItem = memo(function ChatRowItem({ row, selected }: { row: Row; selected: boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const titleOf = useTitleOf();
  const by = row.previewMine ? t('chat.you') : row.previewAuthor ? nameOf(row.previewAuthor).split(' ')[0] : '';
  // A direct chat shows the other person's words without a name, unless the words are mine.
  const showBy = row.preview !== '' && by !== '' && (row.kind !== 'direct' || row.previewMine);
  return (
    <li className="flex items-center">
      <Link
        to={`/inbox/${row.id}`}
        aria-current={selected ? 'page' : undefined}
        className={`pressable flex min-h-[4.25rem] min-w-0 flex-1 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-fill/50 ${selected ? 'bg-fill' : ''}`}
      >
        <Lead row={row} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline justify-between gap-2">
            <bdi className={`min-w-0 truncate text-subheadline ${row.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{titleOf(row)}</bdi>
            <span className="shrink-0 text-footnote text-ink-2"><Age stamp={row.lastAt} /></span>
          </span>
          <span className="flex items-center justify-between gap-2">
            {/* The preview keeps its own direction and its own cut-off, so an English line in an Arabic list keeps its full stop
                at the end and loses its end, not its start, when it is long (audit 2026-10-03, BRW-17). The row itself follows
                the side of the page (owner, 2026-10-05). */}
            <span className={`flex min-w-0 gap-1 text-footnote ${row.unread > 0 ? 'text-ink' : 'text-ink-2'}`}>
              {/* The name and its colon are one unit in the direction of the name: "Faisal:" also in an Arabic row. */}
              {showBy && <bdi className="shrink-0">{by}:</bdi>}
              <bdi dir="auto" className="min-w-0 truncate">{row.preview}</bdi>
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
      <span className="shrink-0 pe-1">
        <ArchiveMenu id={row.id} archived={row.archived} />
      </span>
    </li>
  );
});

/**
 * The chats on the start side: a search field and one link for each project chat, direct chat and task thread. The last line is
 * the quiet row of the archive: "Archived (n)" opens the archived chats, and "Back to Inbox" closes them (owner, 2026-10-18).
 */
export function ChatList({ rows, selectedId }: { rows: Row[]; selectedId: string | undefined }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  // The archived chats leave the main list. The archived list closes by itself when its last chat moves back (owner, 2026-10-18).
  const [wantArchived, setWantArchived] = useState(false);
  const archivedRows = rows.filter((row) => row.archived);
  const archivedOpen = wantArchived && archivedRows.length > 0;
  const listed = archivedOpen ? archivedRows : rows.filter((row) => !row.archived);
  const needle = normalizeForSearch(query);
  // A direct chat matches both names of the person (owner item 12).
  const shown = needle === '' ? listed : listed.filter((row) => normalizeForSearch(`${row.title} ${row.person?.nameAr ?? ''} ${row.project?.name ?? ''}`).includes(needle));
  // A new object on each render: the row ages read the clock on each switch and each search key, as before the memo (RND-5).
  const refresh = {};
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
      {shown.length === 0 && needle !== '' && <p className="px-4 pb-4 text-subheadline text-ink-2">{t('chat.noMatch')}</p>}
      <AgeRefresh.Provider value={refresh}>
        <ul aria-label={t('chat.list')} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
          {shown.map((row) => <ChatRowItem key={row.id} row={row} selected={row.id === selectedId} />)}
          {archivedRows.length > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setWantArchived((on) => !on)}
                className="pressable flex min-h-11 w-full items-center px-4 py-2 text-start text-footnote text-ink-2 hover:text-ink"
              >
                {archivedOpen ? t('chat.backToInbox') : t('chat.archivedCount', { count: archivedRows.length })}
              </button>
            </li>
          )}
        </ul>
      </AgeRefresh.Provider>
    </>
  );
}
