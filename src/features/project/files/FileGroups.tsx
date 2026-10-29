import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../../components/icons/animated/chevron-left';
import { ChevronRightIcon } from '../../../components/icons/animated/chevron-right';
import { FolderOpenIcon } from '../../../components/icons/animated/folder-open';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectFolder } from '../../../api/contract/entities';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { useIsPhone } from '../../../app/useIsPhone';
import { HiddenMark } from '../../../components/HiddenMark';
import { Menu, type MenuItem } from '../../../components/Menu';
import { shownKey } from '../../../lib/projectLabel';
import { DownloadAllButton, QUIET, useDownloadAll } from '../../files/DownloadAll';
import { FileRow } from './FileRow';
import { FileDragContext, placeKey, type Place, type ZoneSlotProps } from './fileDragSlots';
import type { FolderData, GroupData } from './groupsOf';
import { FolderNameField } from './FolderNameField';
import { folderLabel } from './folderLabel';

export { groupsOf, hasContent, projectFoldersOf, type FolderData, type GroupData } from './groupsOf';

/** What a group needs from the tab: the actions on files and folders, and the frame of a file that comes from the computer. */
export type GroupActions = {
  canUpload: boolean;
  /** The person sees the locked folders and may lock or unlock a folder (fbk_074). */
  canLock: boolean;
  onPreview: (view: FileView) => void;
  onShare: (view: FileView) => void;
  onMove: (view: FileView, anchor: HTMLElement | null) => void;
  /** stageId null: a folder of the whole project (fbk_074). */
  createFolder: (stageId: string | null, name: string) => void;
  renameFolder: (id: string, name: string) => void;
  setLock: (id: string, locked: boolean) => void;
  deleteFolder: (id: string) => void;
  /** Opens a folder of the whole project in place (fbk_074). */
  openFolder: (id: string) => void;
  /** The native drop handlers and the frame of a place, for a file from the computer. Missing on a phone and without the upload right. */
  zoneOf: (place: Place) => Pick<ZoneSlotProps, 'framed' | 'native'>;
};

function FileList({ files, detail, actions, className }: { files: FileView[]; detail: ProjectDetail; actions: GroupActions; className?: string }) {
  return (
    <ul className={className}>
      {files.map((view) => (
        <FileRow
          key={view.file.id}
          view={view}
          detail={detail}
          onPreview={() => actions.onPreview(view)}
          onShare={() => actions.onShare(view)}
          onMove={(anchor) => actions.onMove(view, anchor)}
        />
      ))}
    </ul>
  );
}

/** The files of a list as the items of "Download all": the id and the name of each file. */
export const itemsOf = (views: FileView[]) => views.map((view) => ({ id: view.file.id, name: view.file.name }));

/** The mark of a locked folder. Only a person who holds the switch ever gets such a folder, so the mark tells the holder why others do not see it. */
function LockedMark({ folder }: { folder: ProjectFolder }) {
  const { t } = useTranslation();
  return folder.locked === true ? <HiddenMark label={t('folders.lockedMark')} /> : null;
}

/** The menu of a folder (⋯): rename, lock or unlock, "Download all" for two files or more, and delete. The same for a folder of a stage and of the project. */
function FolderMenu({ data, zipName, actions, onRename, onDeleted }: {
  data: FolderData; zipName: () => string; actions: GroupActions; onRename: () => void; onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const { folder, files } = data;
  const zip = useDownloadAll(itemsOf(files), zipName);
  const label = folderLabel(folder, t);
  const items: MenuItem[] = [
    { label: t('folders.rename'), onSelect: onRename, hidden: !actions.canUpload },
    { label: folder.locked === true ? t('folders.unlock') : t('folders.lock'), onSelect: () => actions.setLock(folder.id, folder.locked !== true), hidden: !actions.canLock },
    { label: zip.progress ? t('zip.preparing', zip.progress) : t('zip.all', { count: files.length }), onSelect: () => void zip.run(), hidden: files.length < 2 },
    { label: t('folders.delete'), onSelect: () => { actions.deleteFolder(folder.id); onDeleted?.(); }, hidden: !actions.canUpload, destructive: true },
  ];
  return items.some((item) => !item.hidden) ? <Menu label={t('folders.actions', { name: label })} items={items} sheetOnPhone /> : null;
}

function FolderBlock({ data, stageName, detail, actions }: { data: FolderData; stageName: string; detail: ProjectDetail; actions: GroupActions }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const { Zone } = useContext(FileDragContext);
  const [renaming, setRenaming] = useState(false);
  const { folder, files } = data;
  const label = folderLabel(folder, t);
  const id = `folder-${folder.id}`;
  const place: Place = { stageId: folder.stageId, folderId: folder.id };
  return (
    <Zone place={place} as="div" role="group" aria-labelledby={id} className="mt-1 rounded-xl" {...actions.zoneOf(place)}>
      <div className="flex min-h-11 items-center gap-2 px-2">
        <AnimatedIcon icon={FolderOpenIcon} size={18} className="shrink-0 text-ink-2" aria-hidden />
        {renaming ? (
          <FolderNameField
            initial={label}
            onSave={(name) => {
              setRenaming(false);
              actions.renameFolder(folder.id, name);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <>
            <h4 id={id} dir="auto" className="min-w-0 truncate text-subheadline font-semibold">{label}</h4>
            <LockedMark folder={folder} />
            <span className="tabular shrink-0 text-footnote text-ink-2">{t('folders.count', { count: files.length })}</span>
            <span className="flex-1" />
            <FolderMenu data={data} zipName={() => `${shownKey(detail.project, t)} ${stageName} ${label}`} actions={actions} onRename={() => setRenaming(true)} />
          </>
        )}
      </div>
      {files.length > 0
        ? <FileList files={files} detail={detail} actions={actions} className="ms-4" />
        : <p className="px-2 pb-2 ps-9 text-footnote text-ink-2">{actions.canUpload && !phone ? t('folders.emptyDrag') : t('folders.empty')}</p>}
    </Zone>
  );
}

/** One folder of the whole project in the list (fbk_074): a press opens it in place. The row takes a file that is dragged onto it. */
function ProjectFolderRow({ data, detail, actions }: { data: FolderData; detail: ProjectDetail; actions: GroupActions }) {
  const { t } = useTranslation();
  const { Zone } = useContext(FileDragContext);
  const [renaming, setRenaming] = useState(false);
  const { folder, files } = data;
  const label = folderLabel(folder, t);
  const id = `folder-${folder.id}`;
  const place: Place = { stageId: null, folderId: folder.id };
  return (
    <li>
      <Zone place={place} as="div" role="group" aria-labelledby={id} className="rounded-xl" {...actions.zoneOf(place)}>
        <div className="flex min-h-11 items-center gap-2 px-2">
          {renaming ? (
            <FolderNameField
              initial={label}
              onSave={(name) => {
                setRenaming(false);
                actions.renameFolder(folder.id, name);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <>
              <button type="button" aria-label={t('folders.open', { name: label })} onClick={() => actions.openFolder(folder.id)} className="pressable flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl text-start">
                <AnimatedIcon icon={FolderOpenIcon} size={18} className="shrink-0 text-ink-2" aria-hidden />
                <span id={id} dir="auto" className="min-w-0 truncate text-subheadline font-semibold">{label}</span>
                <LockedMark folder={folder} />
                <span className="tabular shrink-0 text-footnote text-ink-2">{t('folders.count', { count: files.length })}</span>
                <span className="flex-1" />
                <AnimatedIcon icon={ChevronRightIcon} size={16} className="shrink-0 text-ink-2 rtl:-scale-x-100" aria-hidden />
              </button>
              <FolderMenu data={data} zipName={() => `${shownKey(detail.project, t)} ${label}`} actions={actions} onRename={() => setRenaming(true)} />
            </>
          )}
        </div>
      </Zone>
    </li>
  );
}

/**
 * The folders of the whole project (fbk_074), above the stage groups. A press on a folder opens it in place (`OpenFolder`). "+ Folder" is a quiet
 * text button in the heading row, as in a stage, for a person who may upload. The section shows for a person who may upload even with no folder,
 * because an older project has none yet.
 */
export function ProjectFolders({ folders, detail, actions }: { folders: FolderData[]; detail: ProjectDetail; actions: GroupActions }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  if (folders.length === 0 && !actions.canUpload) return null;
  return (
    <section aria-labelledby="files-project" className="surface rounded-card p-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 pt-1">
        <h3 id="files-project" className="min-w-0 text-headline">{t('folders.projectTitle')}</h3>
        {actions.canUpload && <button type="button" aria-label={t('folders.addForProject')} onClick={() => setAdding(true)} className={QUIET}>{t('folders.add')}</button>}
      </div>
      {adding && (
        <div className="flex px-2 pt-2">
          <FolderNameField
            onSave={(name) => {
              setAdding(false);
              actions.createFolder(null, name);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {folders.length > 0 && <ul className="mt-1 flex flex-col">{folders.map((data) => <ProjectFolderRow key={data.folder.id} data={data} detail={detail} actions={actions} />)}</ul>}
    </section>
  );
}

/**
 * One folder of the whole project, open in place (fbk_074): the tab shows only this folder's files, with one back step to the full list. The
 * title is the name of the folder. A file from the computer that is dropped here, and a file chosen with Add, goes into the folder.
 */
export function OpenFolder({ data, detail, actions, onBack }: { data: FolderData; detail: ProjectDetail; actions: GroupActions; onBack: () => void }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const { Zone } = useContext(FileDragContext);
  const [renaming, setRenaming] = useState(false);
  const { folder, files } = data;
  const label = folderLabel(folder, t);
  const id = `folder-${folder.id}`;
  const place: Place = { stageId: null, folderId: folder.id };
  return (
    <Zone place={place} as="section" aria-labelledby={id} className="surface rounded-card p-2" {...actions.zoneOf(place)}>
      <button type="button" aria-label={t('folders.backLabel')} onClick={onBack} className={`${QUIET} ms-1 gap-1`}>
        <AnimatedIcon icon={ChevronLeftIcon} size={14} className="rtl:-scale-x-100" aria-hidden />
        {t('folders.back')}
      </button>
      <div className="flex min-h-11 items-center gap-2 px-2">
        {renaming ? (
          <FolderNameField
            initial={label}
            onSave={(name) => {
              setRenaming(false);
              actions.renameFolder(folder.id, name);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <>
            <h3 id={id} dir="auto" className="min-w-0 truncate text-headline">{label}</h3>
            <LockedMark folder={folder} />
            <span className="tabular shrink-0 text-footnote text-ink-2">{t('folders.count', { count: files.length })}</span>
            <span className="flex-1" />
            <FolderMenu data={data} zipName={() => `${shownKey(detail.project, t)} ${label}`} actions={actions} onRename={() => setRenaming(true)} onDeleted={onBack} />
          </>
        )}
      </div>
      {files.length > 0
        ? <FileList files={files} detail={detail} actions={actions} />
        : <p className="px-2 pb-2 text-footnote text-ink-2">{actions.canUpload && !phone ? t('folders.emptyDrag') : t('folders.empty')}</p>}
    </Zone>
  );
}

function StageGroup({ group, detail, actions }: { group: GroupData; detail: ProjectDetail; actions: GroupActions }) {
  const { t } = useTranslation();
  const { Zone } = useContext(FileDragContext);
  const [adding, setAdding] = useState(false);
  const id = `files-${group.stageId ?? 'none'}`;
  const place: Place = { stageId: group.stageId, folderId: null };
  const all = [...group.loose, ...group.folders.flatMap((folder) => folder.files)];
  return (
    <Zone place={place} as="section" aria-labelledby={id} className="surface rounded-card p-2" {...actions.zoneOf(place)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 pt-1">
        <h3 id={id} dir="auto" className="min-w-0 text-headline">{group.name}</h3>
        <div className="flex shrink-0 items-center gap-3">
          {/* "+ Folder" is a quiet text button before "Download all" (fbk_066). "No stage" has none: a stage folder always sits in a real stage. */}
          {actions.canUpload && group.stageId !== null && (
            <button type="button" aria-label={t('folders.addFor', { stage: group.name })} onClick={() => setAdding(true)} className={QUIET}>{t('folders.add')}</button>
          )}
          <DownloadAllButton items={itemsOf(all)} zipName={() => `${shownKey(detail.project, t)} ${group.name}`} scope={group.name} />
        </div>
      </div>
      {adding && group.stageId !== null && (
        <div className="flex px-2 pt-2">
          <FolderNameField
            onSave={(name) => {
              setAdding(false);
              actions.createFolder(group.stageId!, name);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {group.loose.length > 0 && <FileList files={group.loose} detail={detail} actions={actions} />}
      {group.folders.map((data) => <FolderBlock key={placeKey({ stageId: group.stageId, folderId: data.folder.id })} data={data} stageName={group.name} detail={detail} actions={actions} />)}
    </Zone>
  );
}

/** The stage groups of the Files & Links tab, each with its loose files and its folders (fbk_066). */
export function FileGroups({ groups, detail, actions }: { groups: GroupData[]; detail: ProjectDetail; actions: GroupActions }) {
  return <>{groups.map((group) => <StageGroup key={group.stageId ?? 'none'} group={group} detail={detail} actions={actions} />)}</>;
}
