import { Command } from 'cmdk';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import type { UserCard } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { SubCompanyLogo } from '../../components/SubCompanyLogo';
import { counted } from '../../lib/grammar';
import { useCall } from '../../app/runtime';
import { useDebounced } from '../../app/useDebounced';
import { useCan } from '../../app/useRight';
import { Avatar } from '../../components/Avatar';
import { ScreenTitle } from '../../components/ScreenTitle';
import { normalizeForSearch } from '../../lib/text';
import { NewProjectSheet, usePrepareNewProject } from '../projects/NewProjectSheet';
import { NewTaskSheet } from './NewTaskSheet';
import { PersonSheet } from './PersonSheet';
import { useQueryInLink } from './useQueryInLink';
import { LoadFailed } from '../../components/LoadFailed';
import { taskLink } from '../../lib/params';
import { searchWords } from '../../lib/searchMatch';
import { MessageHits } from './MessageHits';
import { projectKey } from '../../lib/projectCode';

const GROUP = 'flex flex-col [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-footnote [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-label-2';

function Item({ value, onSelect, onPrepare, children }: { value: string; onSelect: () => void; onPrepare?: () => void; children: ReactNode }) {
  return (
    <Command.Item value={value} onSelect={onSelect} onPointerDown={onPrepare} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-body data-[selected=true]:bg-fill">
      {children}
    </Command.Item>
  );
}

function Results({ query, onPerson, messagesFirst }: { query: string; onPerson: (person: UserCard) => void; messagesFirst: boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const lang = useLang();
  const navigate = useNavigate();
  // The last results stay while the next ones load, so the list never flashes empty between key presses (audit PER-14).
  const results = useCall('search.query', { text: query }, { keepPrevious: true });
  if (results.error) return <LoadFailed error={results.error} onRetry={() => void results.refetch()} />;
  if (!results.data) return null;
  const { projects, tasks, people, files } = results.data;
  const subCompanies = results.data.subCompanies ?? [];
  const messages = results.data.messages ?? [];
  if (projects.length + tasks.length + people.length + files.length + subCompanies.length + messages.length === 0) {
    // An empty search says what to try next (audit PER-18).
    return (
      <div className="flex flex-col gap-1 px-3 py-2">
        <p className="text-subheadline text-label-2">{t('search.empty', { text: query })}</p>
        <p className="text-footnote text-label-2">{t('projectCode.searchHint', { example: '260902AZT' })}</p>
      </div>
    );
  }
  return (
    <>
      {/* The chat header opens the screen with ?in=messages: the Messages group comes first then (Direction D). */}
      {messagesFirst && <MessageHits hits={messages} words={searchWords(query)} />}
      {projects.length > 0 && (
        <Command.Group heading={t('search.projects')} className={GROUP}>
          {projects.map((p) => (
            <Item key={p.id} value={`project-${p.id}`} onSelect={() => navigate(`/projects/${p.id}`)}>
              <span className="tabular text-footnote text-label-2">{projectKey(p.code)}</span>
              <bdi>{p.name}</bdi>
            </Item>
          ))}
        </Command.Group>
      )}
      {subCompanies.length > 0 && (
        <Command.Group heading={t('search.subCompanies')} className={GROUP}>
          {subCompanies.map((sub) => (
            <Item key={sub.id} value={`sub-company-${sub.id}`} onSelect={() => navigate(`/projects?subCompany=${sub.id}`)}>
              <span aria-hidden><SubCompanyLogo subCompanyId={sub.id} size={24} /></span>
              <bdi className="min-w-0 flex-1 truncate">{lang === 'ar' ? sub.nameAr : sub.name}</bdi>
              <span className="text-footnote text-label-2">{counted(t, 'subCompanies.projectCount', sub.projects)}</span>
            </Item>
          ))}
        </Command.Group>
      )}
      {tasks.length > 0 && (
        <Command.Group heading={t('search.tasks')} className={GROUP}>
          {tasks.map((task) => (
            <Item key={task.id} value={`task-${task.id}`} onSelect={() => navigate(taskLink(task.projectId, task.id))}>
              <bdi className="min-w-0 flex-1 truncate">{task.title}</bdi>
              {/* An office task shows the word Office where a project key shows (owner, 2026-10-06). */}
              <span className="tabular text-footnote text-label-2">{task.projectId === null ? t('office.word') : projectKey(task.projectCode)}</span>
            </Item>
          ))}
        </Command.Group>
      )}
      {people.length > 0 && (
        <Command.Group heading={t('search.people')} className={GROUP}>
          {people.map((person) => (
            <Item key={person.id} value={`person-${person.id}`} onSelect={() => onPerson(person)}>
              <span aria-hidden><Avatar user={person} size={24} /></span>
              <bdi className="min-w-0 flex-1 truncate">{nameOf(person)}</bdi>
              <span className="text-footnote text-label-2">{person.discipline}</span>
            </Item>
          ))}
        </Command.Group>
      )}
      {files.length > 0 && (
        <Command.Group heading={t('search.files')} className={GROUP}>
          {files.map((file) => (
            <Item
              key={file.id}
              value={`file-${file.id}`}
              // A file of an office task opens on its task, which holds its files (owner, 2026-10-06).
              onSelect={() => navigate(file.projectId === null ? taskLink(null, file.taskId ?? '') : `/projects/${file.projectId}?tab=files&file=${file.id}`)}
            >
              <bdi className="min-w-0 flex-1 truncate">{file.name}</bdi>
              <span className="tabular text-footnote text-label-2">{file.projectId === null ? t('office.word') : projectKey(file.projectCode)}</span>
            </Item>
          ))}
        </Command.Group>
      )}
      {/* The Messages group is last: the newest messages and task comments that hold every word (chat design 2026-10-19, item 16). */}
      {!messagesFirst && <MessageHits hits={messages} words={searchWords(query)} />}
    </>
  );
}

/** Search for projects, tasks, people, files and messages, and commands (spec 7.3). The arrow keys move, Enter opens. */
export function SearchScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The search text lives in the link too, so Back from a result shows the same search again (audit PER-14).
  const [params] = useSearchParams();
  const [text, setText] = useState(() => params.get('q') ?? '');
  // ?in=messages (the Search icon of a chat header) shows Messages first and no Commands. It is a mark of the screen and no field of a call.
  const messagesOnly = params.get('in') === 'messages';
  const query = useDebounced(text.trim(), 150);
  useQueryInLink(query);
  const [sheet, setSheet] = useState<'task' | 'project' | null>(null);
  const [person, setPerson] = useState<UserCard | null>(null);
  const may = useCan();
  const prepareNew = usePrepareNewProject();
  // A command shows only when the switch behind it is on (role rights version 2). New to-do makes a to-do of a project.
  const commands = [
    { id: 'new-task', label: t('search.command.newTask'), run: () => setSheet('task'), show: may('task.add', { projectRole: 'team' }) },
    { id: 'new-project', label: t('search.command.newProject'), run: () => setSheet('project'), show: may('project.create'), prepare: prepareNew },
    { id: 'dashboard', label: t('search.command.dashboard'), run: () => navigate('/dashboard'), show: may('dashboard.view') },
    { id: 'my-work', label: t('search.command.myWork'), run: () => navigate('/work'), show: true },
  ].filter((command) => command.show && !messagesOnly).filter((command) => !text.trim() || normalizeForSearch(command.label).includes(normalizeForSearch(text)));
  return (
    <>
      <ScreenTitle title={t('screens.search')} />
      <Command label={t('search.label')} shouldFilter={false} className="flex flex-col gap-3">
        <Command.Input
          autoFocus
          value={text}
          onValueChange={setText}
          placeholder={messagesOnly ? t('chat.searchMessages') : t('search.placeholderAll')}
          className="panel min-h-14 w-full !rounded-2xl px-5 text-[calc(18px*var(--boost))] text-ink placeholder:text-ink-2 focus-visible:outline-2 focus-visible:outline-[var(--c-link)]"
        />
        {/* The list gets its own name: the library default is the English word "Suggestions" (audit 2026-10-03, F-4). */}
        <Command.List label={t('search.suggestions')} className="surface flex flex-col gap-2 rounded-card p-2">
          {commands.length > 0 && (
            <Command.Group heading={t('search.commands')} className={GROUP}>
              {commands.map((command) => <Item key={command.id} value={`command-${command.id}`} onSelect={command.run} onPrepare={command.prepare}>{command.label}</Item>)}
            </Command.Group>
          )}
          {query && <Results query={query} onPerson={setPerson} messagesFirst={messagesOnly} />}
        </Command.List>
      </Command>
      <NewTaskSheet open={sheet === 'task'} onOpenChange={(open) => { if (!open) setSheet(null); }} />
      {may('project.create') && <NewProjectSheet open={sheet === 'project'} onOpenChange={(open) => { if (!open) setSheet(null); }} />}
      {person && <PersonSheet person={person} onClose={() => setPerson(null)} />}
    </>
  );
}
