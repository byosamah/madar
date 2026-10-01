import { Command } from 'cmdk';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { UserCard } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { useDebounced } from '../../app/useDebounced';
import { Avatar } from '../../components/Avatar';
import { ScreenTitle } from '../../components/ScreenTitle';
import { normalizeForSearch } from '../../lib/text';
import { NewProjectSheet } from '../projects/NewProjectSheet';
import { NewTaskSheet } from './NewTaskSheet';
import { PersonSheet } from './PersonSheet';
import { LoadFailed } from '../../components/LoadFailed';

const GROUP = 'flex flex-col [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-footnote [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-label-2';

function Item({ value, onSelect, children }: { value: string; onSelect: () => void; children: ReactNode }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-body data-[selected=true]:bg-fill">
      {children}
    </Command.Item>
  );
}

function Results({ query, onPerson }: { query: string; onPerson: (person: UserCard) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const results = useCall('search.query', { text: query });
  if (results.error) return <LoadFailed error={results.error} onRetry={() => void results.refetch()} />;
  if (!results.data) return null;
  const { projects, tasks, people, files } = results.data;
  if (projects.length + tasks.length + people.length + files.length === 0) {
    return <p className="px-3 py-2 text-subheadline text-label-2">{t('search.empty', { text: query })}</p>;
  }
  return (
    <>
      {projects.length > 0 && (
        <Command.Group heading={t('search.projects')} className={GROUP}>
          {projects.map((p) => (
            <Item key={p.id} value={`project-${p.id}`} onSelect={() => navigate(`/projects/${p.id}`)}>
              <span className="tabular text-footnote text-label-2">{p.code}</span>
              <bdi>{p.name}</bdi>
            </Item>
          ))}
        </Command.Group>
      )}
      {tasks.length > 0 && (
        <Command.Group heading={t('search.tasks')} className={GROUP}>
          {tasks.map((task) => (
            <Item key={task.id} value={`task-${task.id}`} onSelect={() => navigate(`/projects/${task.projectId}?tab=tasks&task=${task.id}`)}>
              <bdi className="min-w-0 flex-1 truncate">{task.title}</bdi>
              <span className="tabular text-footnote text-label-2">{task.projectCode}</span>
            </Item>
          ))}
        </Command.Group>
      )}
      {people.length > 0 && (
        <Command.Group heading={t('search.people')} className={GROUP}>
          {people.map((person) => (
            <Item key={person.id} value={`person-${person.id}`} onSelect={() => onPerson(person)}>
              <span aria-hidden><Avatar user={person} size={24} /></span>
              <bdi className="min-w-0 flex-1 truncate">{person.name}</bdi>
              <span className="text-footnote text-label-2">{person.discipline}</span>
            </Item>
          ))}
        </Command.Group>
      )}
      {files.length > 0 && (
        <Command.Group heading={t('search.files')} className={GROUP}>
          {files.map((file) => (
            <Item key={file.id} value={`file-${file.id}`} onSelect={() => navigate(`/projects/${file.projectId}?tab=files`)}>
              <bdi className="min-w-0 flex-1 truncate">{file.name}</bdi>
              <span className="tabular text-footnote text-label-2">{file.projectCode}</span>
            </Item>
          ))}
        </Command.Group>
      )}
    </>
  );
}

/** Search for projects, tasks, people and files, and commands (spec 7.3). The arrow keys move, Enter opens. */
export function SearchScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), 150);
  const [sheet, setSheet] = useState<'task' | 'project' | null>(null);
  const [person, setPerson] = useState<UserCard | null>(null);
  const commands = [
    { id: 'new-task', label: t('search.command.newTask'), run: () => setSheet('task') },
    { id: 'new-project', label: t('search.command.newProject'), run: () => setSheet('project') },
    { id: 'log-time', label: t('search.command.logTime'), run: () => navigate('/work?tab=hours') },
    { id: 'dashboard', label: t('search.command.dashboard'), run: () => navigate('/dashboard') },
    { id: 'my-work', label: t('search.command.myWork'), run: () => navigate('/work') },
  ].filter((command) => !text.trim() || normalizeForSearch(command.label).includes(normalizeForSearch(text)));
  return (
    <>
      <ScreenTitle title={t('screens.search')} />
      <Command label={t('search.label')} shouldFilter={false} className="flex flex-col gap-3">
        <Command.Input
          autoFocus
          value={text}
          onValueChange={setText}
          placeholder={t('search.placeholder')}
          className="panel min-h-14 w-full !rounded-2xl px-5 text-[calc(18px*var(--boost))] text-ink placeholder:text-ink-2 focus-visible:outline-2 focus-visible:outline-[var(--c-link)]"
        />
        <Command.List className="surface flex flex-col gap-2 rounded-card p-2">
          {commands.length > 0 && (
            <Command.Group heading={t('search.commands')} className={GROUP}>
              {commands.map((command) => <Item key={command.id} value={`command-${command.id}`} onSelect={command.run}>{command.label}</Item>)}
            </Command.Group>
          )}
          {query && <Results query={query} onPerson={setPerson} />}
        </Command.List>
      </Command>
      <NewTaskSheet open={sheet === 'task'} onOpenChange={(open) => { if (!open) setSheet(null); }} />
      <NewProjectSheet open={sheet === 'project'} onOpenChange={(open) => { if (!open) setSheet(null); }} />
      {person && <PersonSheet person={person} onClose={() => setPerson(null)} />}
    </>
  );
}
