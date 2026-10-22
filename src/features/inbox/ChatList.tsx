import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { SearchIcon } from '../../components/icons/animated/search';
import { motion } from 'motion/react';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { Age, AgeRefresh } from '../../components/Age';
import { PersonFace } from '../../components/PersonFace';
import { ProjectTile } from '../../components/ProjectTile';
import { normalizeForSearch } from '../../lib/text';
import { isFinePointer } from '../../lib/calendar';
import { usePersonName } from '../../app/personName';
import { usePersistentChoice } from '../../app/choices';
import { useStableHandler } from '../../app/useStableHandler';
import { useTypers } from '../../app/live/typing';
import { useCall } from '../../app/runtime';
import { actorContext } from '../../lib/grammar';
import { useIsPhone } from '../../app/useIsPhone';
import { usePointerCoarse } from '../../app/usePointerCoarse';
import { useStaged } from '../../app/useStaged';
import { Menu, type MenuItem } from '../../components/Menu';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { ChevronRightIcon } from '../../components/icons/animated/chevron-right';
import { ClipboardCheckIcon } from '../../components/icons/animated/clipboard-check';
import { SlidersHorizontalIcon } from '../../components/icons/animated/sliders-horizontal';
import { reasonLineText } from '../comments/ReasonLine';
import { useArchive } from './archive';
import { GroupPicture } from './GroupPicture';
import { chatState } from './chatBack';

type Row = CallOutput<'chats.list'>[number];

function Lead({ row }: { row: Row }) {
  if (row.kind === 'project' && row.project) return <ProjectTile id={row.project.id} mark={row.project.mark} size={40} />;
  if (row.kind === 'direct' && row.person) return <PersonFace user={{ ...row.person, active: !row.personLeft }} size={40} />;
  // A group has one picture of its own, never a stack of faces (UX audit 2026-10-19, chats-08).
  if (row.kind === 'group') return <GroupPicture id={row.id} size={40} />;
  return <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-ink-2"><AnimatedIcon icon={ClipboardCheckIcon} size={18} aria-hidden /></span>;
}

/** The title of a row: a direct chat shows the other person's name in the screen language (owner item 12). */
export function useTitleOf(): (row: Row) => string {
  const nameOf = usePersonName();
  return (row) => (row.kind === 'direct' && row.person ? nameOf(row.person) : row.title);
}

/**
 * The items of the menu of a chat, in its row and in its header: "Mark as unread" for a chat that was read (fbk_028, owner 2026-10-19),
 * and Archive, or Move back to Inbox in the archived list (owner, 2026-10-18). A chat with new messages is unread already, and an
 * archived chat is out of the list, so neither offers "Mark as unread". Only the person sees the menu: an agent never archives a chat or
 * marks it unread (the MCP deny list).
 */
export function chatMenuItems(
  t: TFunction,
  { id, archived, unread, onArchive, onMarkUnread }: {
    id: string; archived: boolean; unread: number; onArchive: (id: string, archived: boolean) => void; onMarkUnread: (id: string) => void;
  },
): MenuItem[] {
  return [
    ...(!archived && unread === 0 ? [{ label: t('chat.markUnread'), onSelect: () => onMarkUnread(id) }] : []),
    { label: archived ? t('chat.moveBack') : t('chat.archive'), onSelect: () => onArchive(id, !archived) },
  ];
}

/**
 * The menu of a chat or a task thread. The button names its chat, so a screen reader does not hear "Chat options" for every row (UX
 * audit 2026-10-19, chats-06). The extra items come after Archive: the header menu adds "Notify me" there (chat design item 21). The row
 * menu adds none.
 */
export function ChatMenu({ id, archived, unread, title, onArchive, onMarkUnread, extra = [] }: {
  id: string; archived: boolean; unread: number; title: string; onArchive: (id: string, archived: boolean) => void; onMarkUnread: (id: string) => void;
  extra?: MenuItem[];
}) {
  const { t } = useTranslation();
  return <Menu label={t('chat.optionsFor', { title })} items={[...chatMenuItems(t, { id, archived, unread, onArchive, onMarkUnread }), ...extra]} />;
}

/**
 * The kinds of the filter beside the search (owner, 2026-10-20): Projects holds the project chats, To-dos the threads of to-dos, and
 * People the direct chats and the groups.
 */
const KINDS = ['all', 'projects', 'todos', 'people'] as const;
type ChatKind = (typeof KINDS)[number];

function inKind(row: Row, kind: ChatKind): boolean {
  if (kind === 'projects') return row.kind === 'project';
  if (kind === 'todos') return row.kind === 'task';
  if (kind === 'people') return row.kind === 'direct' || row.kind === 'group';
  return true;
}

/** The rows that the Inbox list draws before the first paint. A longer list draws the others at an idle moment (RN-2). */
const FIRST_ROWS = 40;

/** How far a swipe goes before the row archives. The same as the swipe of the Notifications rows. */
const SWIPE_PX = 80;

/**
 * Memoized, so a chat switch, a send or a key in the search renders again only the rows whose data or selection changed
 * (performance audit 2026-10-07, RND-5). A row keeps its object across reloads (structural sharing), and its age refreshes
 * through AgeRefresh.
 *
 * The menu button of a row shows only while the pointer is on the row or the keyboard is in it (UX audit 2026-10-19, chats-06).
 * On a phone, or where the pointer is a finger, the button is gone and a swipe archives the row, with the toast and its Undo.
 */
/**
 * The line that takes the place of the last message while somebody types in the chat (chat presence design B2): "typing..." in a direct
 * chat, "Reem is typing..." in a project chat or a group (the first typist). Only a row where somebody types holds it, so the other rows
 * do not watch the office list. While the name of a typist is not known yet, the last message stays.
 */
function TypingPreview({ row, typers, fallback }: { row: Row; typers: string[]; fallback: ReactNode }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const forPerson = row.kind === 'direct' && row.person !== null;
  const users = useCall('users.list', {}, { enabled: !forPerson });
  let text: string | null = null;
  if (forPerson) text = t('chat.typingRow', { context: actorContext(row.person) });
  else {
    const typist = users.data?.find((user) => user.id === typers[0]);
    if (typist) text = t('chat.typingOne', { name: nameOf(typist).split(' ')[0], context: actorContext(typist) });
  }
  return text === null ? <>{fallback}</> : <bdi dir="auto" className="min-w-0 truncate text-link">{text}</bdi>;
}

const ChatRowItem = memo(function ChatRowItem({ row, selected, swipe, noMenu, showArchived, onArchive, onMarkUnread }: {
  row: Row; selected: boolean; swipe: boolean; noMenu: boolean; showArchived: boolean; onArchive: (id: string, archived: boolean) => void; onMarkUnread: (id: string) => void;
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const titleOf = useTitleOf();
  const title = titleOf(row);
  const by = row.previewMine ? t('chat.you') : row.previewAuthor ? nameOf(row.previewAuthor).split(' ')[0] : '';
  // A direct chat shows the other person's words without a name, unless the words are mine.
  const showBy = row.preview !== '' && by !== '' && (row.kind !== 'direct' || row.previewMine);
  // A row reads the typists of its own chat alone, so a signal in another chat renders no other row.
  const typers = useTypers(row.id);
  // The newest item of a task thread can be a quiet line of a reason: the row then shows its short line, "Faisal changed the due date: ..."
  // (fbk_027). It names the person by the first name, also when the person is the viewer.
  const reasonText = row.previewKind
    ? reasonLineText(t, { kind: row.previewKind, body: row.preview }, row.previewAuthor ? { name: nameOf(row.previewAuthor).split(' ')[0], gender: row.previewAuthor.gender } : null, true)
    : null;
  const preview = (
    <>
      {reasonText === null && showBy && <bdi className="shrink-0">{by}:</bdi>}
      <bdi dir="auto" className="min-w-0 truncate">{reasonText ?? row.preview}</bdi>
    </>
  );
  // A swipe on a phone must not also open the chat.
  const swiped = useRef(false);
  return (
    <motion.li
      drag={swipe ? 'x' : false}
      dragSnapToOrigin
      onDragStart={() => {
        swiped.current = true;
      }}
      onDragEnd={(_event, info) => {
        if (Math.abs(info.offset.x) > SWIPE_PX) onArchive(row.id, !row.archived);
        window.setTimeout(() => {
          swiped.current = false;
        }, 0);
      }}
      className={`group relative flex items-center transition-colors hover:bg-fill/50 ${selected ? 'bg-fill' : 'bg-panel'}`}
    >
      <Link
        to={`/inbox/${row.id}`}
        state={chatState('/inbox')}
        aria-current={selected ? 'page' : undefined}
        onClick={(event) => {
          if (swiped.current) event.preventDefault();
        }}
        className="pressable flex min-h-[4.25rem] min-w-0 flex-1 items-center gap-3 px-3 py-2.5"
      >
        <Lead row={row} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline justify-between gap-2">
            <bdi className={`min-w-0 truncate text-subheadline ${row.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{title}</bdi>
            <span className="shrink-0 text-footnote text-ink-2">
              {showArchived && row.archived && <>{t('chat.archived')}<span aria-hidden> · </span></>}
              <Age stamp={row.lastAt} />
            </span>
          </span>
          <span className="flex items-center justify-between gap-2">
            {/* The preview keeps its own direction and its own cut-off, so an English line in an Arabic list keeps its full stop
                at the end and loses its end, not its start, when it is long (audit 2026-10-03, BRW-17). The row itself follows
                the side of the page (owner, 2026-10-05). */}
            <span className={`flex min-w-0 gap-1 text-footnote ${row.unread > 0 ? 'text-ink' : 'text-ink-2'}`}>
              {/* The name and its colon are one unit in the direction of the name: "Faisal:" also in an Arabic row. */}
              {typers.length === 0 ? preview : <TypingPreview row={row} typers={typers} fallback={preview} />}
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
      {/* The menu takes no room in the row: it floats over the end of the row and shows on hover or focus, so no empty strip waits
          for the mouse (owner, 2026-10-19). A phone has no menu: a swipe archives the chat. */}
      {!noMenu && (
        <span className="absolute inset-y-0 end-1 flex items-center rounded-full pointer-coarse:hidden max-sm:hidden sm:pointer-events-none sm:opacity-0 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:has-[[aria-expanded=true]]:pointer-events-auto sm:has-[[aria-expanded=true]]:opacity-100 [&>*]:bg-panel">
          <ChatMenu id={row.id} archived={row.archived} unread={row.unread} title={title} onArchive={onArchive} onMarkUnread={onMarkUnread} />
        </span>
      )}
    </motion.li>
  );
});

/**
 * The chats on the start side: a search field and one link for each project chat, direct chat, group and task thread.
 * "Archived (n)" is one quiet row under the search field while some chat is archived; it opens the archived chats, which have a
 * title and a back arrow of their own (UX audit 2026-10-19, chats-04 and chats-05). A search in the main list looks in every
 * chat, and an archived match carries the word "Archived". The row menu has "Mark as unread" for a chat that was read (fbk_028).
 * A menu beside the search shows one kind of chat (owner, 2026-10-20). The choice lasts for the next visit (owner, 2026-10-23, key
 * `madar.chatKind`). The search and the archived list look only in the chosen kind.
 */
export function ChatList({ rows, selectedId, onMarkUnread }: { rows: Row[]; selectedId: string | undefined; onMarkUnread: (id: string) => void }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const coarse = usePointerCoarse();
  const archive = useArchive();
  const onArchive = useStableHandler(archive);
  const markUnread = useStableHandler(onMarkUnread);
  const [query, setQuery] = useState('');
  // The last choice lasts after the Inbox closes, after a reload and for the next visit (owner, 2026-10-23).
  const [kind, setKind] = usePersistentChoice<ChatKind>('madar.chatKind', KINDS, 'all');
  const kindRows = kind === 'all' ? rows : rows.filter((row) => inKind(row, kind));
  // The archived chats leave the main list. The archived list closes by itself when its last chat moves back (owner, 2026-10-18).
  const [wantArchived, setWantArchived] = useState(false);
  const archivedRows = kindRows.filter((row) => row.archived);
  // A stale flag must not reopen the archived list on the next archive: it resets when no archived chat is left.
  useEffect(() => {
    if (archivedRows.length === 0) setWantArchived(false);
  }, [archivedRows.length]);
  const archivedOpen = wantArchived && archivedRows.length > 0;
  const needle = normalizeForSearch(query);
  // The main list holds the chats that are not archived; a search looks in all of them. The archived list holds the archived chats.
  const listed = archivedOpen ? archivedRows : needle === '' ? kindRows.filter((row) => !row.archived) : kindRows;
  // A direct chat matches both names of the person (owner item 12). A group matches its name, and only its members have its row.
  const shown = needle === '' ? listed : listed.filter((row) => normalizeForSearch(`${row.title} ${row.person?.nameAr ?? ''} ${row.project?.name ?? ''}`).includes(needle));
  // The first rows draw at once and the others at an idle moment (RN-2). The last list is the same list.
  const drawn = useStaged(shown.length, FIRST_ROWS);
  // A finger swipes. A mouse or a trackpad uses the button that shows on hover.
  const swipe = phone || !isFinePointer();
  // CSS hides the row menu on a phone and under a finger, so those screens do not build it (performance audit 2026-10-21, RN-3).
  const noMenu = phone || coarse;
  // A new object on each render: the row ages read the clock on each switch and each search key, as before the memo (RND-5).
  const refresh = {};
  const searchLabel = archivedOpen ? t('chat.searchArchived') : t('chat.search');
  const kindLabel = t(`chatFilter.${kind}`);
  return (
    <>
      {archivedOpen && (
        <div className="flex items-center gap-1 px-2 pt-2">
          <button
            type="button"
            aria-label={t('chat.backToInbox')}
            onClick={() => {
              setWantArchived(false);
              setQuery('');
            }}
            className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink"
          >
            <AnimatedIcon icon={ChevronLeftIcon} size={20} className="rtl:-scale-x-100" aria-hidden />
          </button>
          <h2 className="min-w-0 truncate text-headline text-ink">{t('chat.archivedTitle')}</h2>
        </div>
      )}
      <div className="flex items-center gap-2 p-3">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="chat-search" className="sr-only">{searchLabel}</label>
          <AnimatedIcon icon={SearchIcon} size={16} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-2" />
          <input
            id="chat-search"
            type="search"
            dir="auto"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchLabel}
            className="min-h-11 w-full rounded-full bg-fill ps-9 pe-4 text-subheadline text-ink placeholder:text-ink-2"
          />
        </div>
        {/* The button names the shown kind, so a person who comes back knows why the list is short. */}
        <Menu
          label={t('chatFilter.label', { kind: kindLabel })}
          text={kindLabel}
          icon={<AnimatedIcon icon={SlidersHorizontalIcon} size={16} aria-hidden />}
          triggerClassName="shrink-0 bg-fill text-ink hover:text-ink-2"
          items={KINDS.map((value) => ({ label: t(`chatFilter.${value}`), checked: value === kind, onSelect: () => setKind(value) }))}
        />
      </div>
      {!archivedOpen && needle === '' && archivedRows.length > 0 && (
        <button
          type="button"
          onClick={() => setWantArchived(true)}
          className="pressable flex min-h-11 w-full shrink-0 items-center justify-between gap-2 px-4 py-2 text-start text-footnote text-ink-2 hover:text-ink"
        >
          <span>{t('chat.archivedCount', { count: archivedRows.length })}</span>
          <AnimatedIcon icon={ChevronRightIcon} size={16} className="rtl:-scale-x-100" aria-hidden />
        </button>
      )}
      {shown.length === 0 && needle !== '' && <p className="px-4 pb-4 text-subheadline text-ink-2">{t('chat.noMatch')}</p>}
      {shown.length === 0 && needle === '' && kind !== 'all' && <p className="px-4 pb-4 text-subheadline text-ink-2">{t('chatFilter.none')}</p>}
      <AgeRefresh.Provider value={refresh}>
        <ul aria-label={t('chat.list')} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
          {shown.slice(0, drawn).map((row) => (
            <ChatRowItem
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              swipe={swipe}
              noMenu={noMenu}
              showArchived={!archivedOpen}
              onArchive={onArchive}
              onMarkUnread={markUnread}
            />
          ))}
        </ul>
      </AgeRefresh.Provider>
    </>
  );
}
