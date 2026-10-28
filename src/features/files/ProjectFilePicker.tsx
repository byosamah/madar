import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useByProjectName, useProjectName } from '../../app/projectName';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { ChevronRightIcon } from '../../components/icons/animated/chevron-right';
import { FolderOpenIcon } from '../../components/icons/animated/folder-open';
import { LoadFailed } from '../../components/LoadFailed';
import { ProjectTile } from '../../components/ProjectTile';
import { Sheet } from '../../components/Sheet';
import { shownKey } from '../../lib/projectLabel';
import { groupsOf, type GroupData } from '../project/files/groupsOf';
import { ProjectSearch } from '../projects/ProjectSearch';
import { CheckRow } from '../settings/admin/CheckRow';

/**
 * Where the picker looks. A project chat and a to-do thread keep to their own project (projectId). A direct chat and a group give their
 * conversationId: the picker then lists only the projects that hold every person of the chat (owner, 2026-10-28).
 */
export type InsertScope = { projectId?: string; conversationId?: string };
/** One project file that the person picked: its id and its name (the words of the message when the person adds none). */
export type PickedProjectFile = { id: string; name: string };

type Level = { kind: 'projects' } | { kind: 'project'; id: string } | { kind: 'stage'; id: string; stageId: string | null };

const ROW = 'pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-start hover:bg-fill';
const COUNT = 'tabular shrink-0 text-footnote text-ink-2';

/**
 * The picker of "Insert from a project" (fbk_070, owner 2026-10-27): the projects the person may open, then the stages of the chosen
 * project ("No stage" too), then the folders and the files outside a folder. The person ticks files or folders (a folder is all its files)
 * and one Send button with the count sends them. The ticks stay while the person steps back. The lists are the reads of the Files tab
 * (projects.list, projects.get, files.list), so a hidden project and a file the person may not open never show. Who may open the file
 * in the chat is the rule of the server (chats.send, as files.share).
 */
export function ProjectFilePicker({ scope, onClose, onSend }: { scope: InsertScope; onClose: () => void; onSend: (files: PickedProjectFile[]) => void }) {
  const { t } = useTranslation();
  const projectName = useProjectName();
  const [level, setLevel] = useState<Level>(scope.projectId ? { kind: 'project', id: scope.projectId } : { kind: 'projects' });
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(() => new Map());
  const detail = useCall('projects.get', { id: level.kind === 'projects' ? 'prj_000' : level.id }, { enabled: level.kind !== 'projects' });
  const toggle = (files: PickedProjectFile[]) => setPicked((current) => {
    const next = new Map(current);
    if (files.every((file) => next.has(file.id))) for (const file of files) next.delete(file.id);
    else for (const file of files) if (!next.has(file.id)) next.set(file.id, file.name);
    return next;
  });
  const back = () => setLevel((now) => (now.kind === 'stage' ? { kind: 'project', id: now.id } : { kind: 'projects' }));
  const canBack = level.kind === 'stage' || (level.kind === 'project' && scope.projectId === undefined);
  const count = picked.size;
  const title = level.kind === 'projects' ? t('attachments.insertFromProject') : (detail.data ? projectName(detail.data.project) : t('attachments.insertFromProject'));
  return (
    <Sheet
      open
      tall
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={title}
      footer={(
        <Button variant="primary" disabled={count === 0} onClick={() => onSend([...picked].map(([id, name]) => ({ id, name })))}>
          {count === 0 ? t('insert.send') : t('insert.send', { count })}
        </Button>
      )}
    >
      <div className="flex min-h-48 flex-col gap-3 pb-2">
        {canBack && (
          <Button variant="plain" className="self-start" onClick={back}>
            <AnimatedIcon icon={ChevronLeftIcon} size={18} className="rtl:-scale-x-100" aria-hidden />
            {t('insert.back')}
          </Button>
        )}
        {level.kind === 'projects' && <Projects conversationId={scope.conversationId} onOpen={(id) => setLevel({ kind: 'project', id })} />}
        {level.kind !== 'projects' && <Stages level={level} onOpenStage={(stageId) => setLevel({ kind: 'stage', id: level.id, stageId })} picked={picked} onToggle={toggle} />}
      </div>
    </Sheet>
  );
}

/**
 * The projects that the person may open, found by a part of the name or the code. In a direct chat or a group, only the projects that
 * hold every person of the chat: the rule of chats.send, asked once for the whole list (chats.insertProjects).
 */
function Projects({ conversationId, onOpen }: { conversationId: string | undefined; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const projectName = useProjectName();
  const byName = useByProjectName();
  const list = useCall('projects.list', { status: 'all' });
  const shared = useCall('chats.insertProjects', { conversationId: conversationId ?? 'cnv_000' }, { enabled: conversationId !== undefined });
  const [word, setWord] = useState('');
  const allowed = useMemo(() => (shared.data ? new Set(shared.data) : null), [shared.data]);
  const rows = useMemo(() => {
    const needle = word.trim().toLowerCase();
    return [...(list.data ?? [])]
      .filter(({ project }) => allowed === null || allowed.has(project.id))
      .filter(({ project }) => needle === '' || `${project.name} ${project.nameAr ?? ''} ${project.code}`.toLowerCase().includes(needle))
      .sort((a, b) => byName(a.project, b.project));
  }, [list.data, allowed, word, byName]);
  if (list.error && !list.data) return <LoadFailed query={list} />;
  if (conversationId !== undefined && shared.error && !shared.data) return <LoadFailed query={shared} />;
  if (!list.data || (conversationId !== undefined && !shared.data)) return <div aria-busy="true" className="min-h-24" />;
  // No project holds every person of the chat: one plain line that says why, and no empty list or search field.
  if (allowed !== null && !list.data.some(({ project }) => allowed.has(project.id))) return <p className="px-1 text-footnote text-ink-2">{t('insert.noShared')}</p>;
  return (
    <>
      <ProjectSearch value={word} onChange={setWord} />
      {rows.length === 0 && <p className="px-1 text-footnote text-ink-2">{t('insert.noProjects')}</p>}
      <ul className="flex flex-col">
        {rows.map(({ project }) => (
          <li key={project.id}>
            <button type="button" className={ROW} onClick={() => onOpen(project.id)}>
              <ProjectTile id={project.id} mark={project.mark} shape={project.shape} size={32} />
              <span className="min-w-0 flex-1">
                <bdi className="block truncate text-body">{projectName(project)}</bdi>
                <span className="block text-footnote text-ink-2">{shownKey(project, t)}</span>
              </span>
              <AnimatedIcon icon={ChevronRightIcon} size={16} className="shrink-0 text-ink-2 rtl:-scale-x-100" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The stages of one project, and inside a stage the folders and the files outside a folder. */
function Stages({ level, onOpenStage, picked, onToggle }: {
  level: Exclude<Level, { kind: 'projects' }>; onOpenStage: (stageId: string | null) => void; picked: ReadonlyMap<string, string>; onToggle: (files: PickedProjectFile[]) => void;
}) {
  const { t } = useTranslation();
  const detail = useCall('projects.get', { id: level.id });
  const files = useCall('files.list', { projectId: level.id });
  const groups = useMemo(() => (detail.data && files.data ? groupsOf(detail.data, files.data, false, t('files.noStage')) : null), [detail.data, files.data, t]);
  if ((detail.error && !detail.data) || (files.error && !files.data)) return <LoadFailed query={detail.error ? detail : files} />;
  if (!groups) return <div aria-busy="true" className="min-h-24" />;
  if (level.kind === 'project') {
    if (groups.length === 0) return <p className="px-1 text-footnote text-ink-2">{t('insert.noFiles')}</p>;
    return (
      <ul className="flex flex-col">
        {groups.map((group) => (
          <li key={group.stageId ?? 'none'}>
            <button type="button" className={ROW} onClick={() => onOpenStage(group.stageId)}>
              <bdi className="min-w-0 flex-1 truncate text-body">{group.name}</bdi>
              <span className={COUNT}>{t('folders.count', { count: group.total })}</span>
              <AnimatedIcon icon={ChevronRightIcon} size={16} className="shrink-0 text-ink-2 rtl:-scale-x-100" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    );
  }
  const group = groups.find((item) => item.stageId === level.stageId);
  return group ? <StageFiles group={group} picked={picked} onToggle={onToggle} /> : <p className="px-1 text-footnote text-ink-2">{t('insert.noFiles')}</p>;
}

/** The folders of a stage (a folder with no file is left out) and its files outside a folder. A folder is ticked as all its files. */
function StageFiles({ group, picked, onToggle }: { group: GroupData; picked: ReadonlyMap<string, string>; onToggle: (files: PickedProjectFile[]) => void }) {
  const { t } = useTranslation();
  const pick = (views: { file: { id: string; name: string } }[]) => views.map(({ file }) => ({ id: file.id, name: file.name }));
  return (
    <ul className="flex flex-col">
      {group.folders.filter((data) => data.files.length > 0).map((data) => (
        <li key={data.folder.id}>
          <CheckRow
            id={`insert-folder-${data.folder.id}`}
            className="w-full"
            checked={data.files.every(({ file }) => picked.has(file.id))}
            onChange={() => onToggle(pick(data.files))}
          >
            <AnimatedIcon icon={FolderOpenIcon} size={18} className="shrink-0 text-ink-2" aria-hidden />
            <bdi className="min-w-0 flex-1 truncate text-body">{data.folder.name}</bdi>
            <span className={COUNT}>{t('folders.count', { count: data.files.length })}</span>
          </CheckRow>
        </li>
      ))}
      {group.loose.map((view) => (
        <li key={view.file.id}>
          <CheckRow id={`insert-file-${view.file.id}`} className="w-full" checked={picked.has(view.file.id)} onChange={() => onToggle(pick([view]))}>
            <bdi className="min-w-0 flex-1 truncate text-body">{view.file.name}</bdi>
          </CheckRow>
        </li>
      ))}
    </ul>
  );
}
