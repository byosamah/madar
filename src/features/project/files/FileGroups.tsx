import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FolderOpenIcon } from '../../../components/icons/animated/folder-open';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectFolder } from '../../../api/contract/entities';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { useIsPhone } from '../../../app/useIsPhone';
import { Menu, type MenuItem } from '../../../components/Menu';
import { shownKey } from '../../../lib/projectLabel';
import { DownloadAllButton, QUIET, useDownloadAll } from '../../files/DownloadAll';
import { FileRow } from './FileRow';
import { FileDragContext, foldersOf, placeKey, type Place, type ZoneSlotProps } from './fileDragSlots';
import { FolderNameField } from './FolderNameField';

/** One folder of a stage group with its files, in the order the folder was made. */
export type FolderData = { folder: ProjectFolder; files: FileView[] };
/** One group of the list: a stage (or "No stage") with the files that sit at its root, and its folders. `total` counts all of its files. */
export type GroupData = { stageId: string | null; name: string; loose: FileView[]; folders: FolderData[]; total: number };

/**
 * The groups of the list (fbk_066). A file sits in a folder only when that folder is in the stage of the file: any other folderId reads as
 * the root of the stage, so no file is hidden. A group shows when it has files or folders. A person who may upload also sees the stages with
 * nothing, because "+ Folder" sits in the heading row of its stage. "No stage" shows only with files.
 */
export function groupsOf(detail: ProjectDetail, views: FileView[], showEmptyStages: boolean, noStageName: string): GroupData[] {
  const stages = detail.stages.map((stage) => ({ stageId: stage.id as string | null, name: stage.name }));
  return [...stages, { stageId: null, name: noStageName }]
    .map(({ stageId, name }) => {
      const mine = views.filter((view) => view.file.stageId === stageId);
      const folders = stageId === null ? [] : foldersOf(detail).filter((folder) => folder.stageId === stageId);
      const inFolder = (view: FileView, folder: ProjectFolder) => view.file.folderId === folder.id;
      return {
        stageId,
        name,
        loose: mine.filter((view) => !folders.some((folder) => inFolder(view, folder))),
        folders: folders.map((folder) => ({ folder, files: mine.filter((view) => inFolder(view, folder)) })),
        total: mine.length,
      };
    })
    .filter((group) => group.total > 0 || group.folders.length > 0 || (showEmptyStages && group.stageId !== null));
}

/** What a group needs from the tab: the actions on files and folders, and the frame of a file that comes from the computer. */
export type GroupActions = {
  canUpload: boolean;
  onPreview: (view: FileView) => void;
  onShare: (view: FileView) => void;
  onMove: (view: FileView, anchor: HTMLElement | null) => void;
  createFolder: (stageId: string, name: string) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
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

const itemsOf = (views: FileView[]) => views.map((view) => ({ id: view.file.id, name: view.file.name }));

function FolderBlock({ data, stageName, detail, actions }: { data: FolderData; stageName: string; detail: ProjectDetail; actions: GroupActions }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const { Zone } = useContext(FileDragContext);
  const [renaming, setRenaming] = useState(false);
  const { folder, files } = data;
  const id = `folder-${folder.id}`;
  const place: Place = { stageId: folder.stageId, folderId: folder.id };
  const zip = useDownloadAll(itemsOf(files), () => `${shownKey(detail.project, t)} ${stageName} ${folder.name}`);
  const items: MenuItem[] = [
    { label: t('folders.rename'), onSelect: () => setRenaming(true), hidden: !actions.canUpload },
    { label: zip.progress ? t('zip.preparing', zip.progress) : t('zip.all', { count: files.length }), onSelect: () => void zip.run(), hidden: files.length < 2 },
    { label: t('folders.delete'), onSelect: () => actions.deleteFolder(folder.id), hidden: !actions.canUpload, destructive: true },
  ];
  return (
    <Zone place={place} as="div" role="group" aria-labelledby={id} className="mt-1 rounded-xl" {...actions.zoneOf(place)}>
      <div className="flex min-h-11 items-center gap-2 px-2">
        <AnimatedIcon icon={FolderOpenIcon} size={18} className="shrink-0 text-ink-2" aria-hidden />
        {renaming ? (
          <FolderNameField
            initial={folder.name}
            onSave={(name) => {
              setRenaming(false);
              actions.renameFolder(folder.id, name);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <>
            <h4 id={id} dir="auto" className="min-w-0 truncate text-subheadline font-semibold">{folder.name}</h4>
            <span className="tabular shrink-0 text-footnote text-ink-2">{t('folders.count', { count: files.length })}</span>
            <span className="flex-1" />
            {items.some((item) => !item.hidden) && <Menu label={t('folders.actions', { name: folder.name })} items={items} sheetOnPhone />}
          </>
        )}
      </div>
      {files.length > 0
        ? <FileList files={files} detail={detail} actions={actions} className="ms-4" />
        : <p className="px-2 pb-2 ps-9 text-footnote text-ink-2">{actions.canUpload && !phone ? t('folders.emptyDrag') : t('folders.empty')}</p>}
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
          {/* "+ Folder" is a quiet text button before "Download all" (fbk_066). "No stage" has none: a folder always sits in a real stage. */}
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
