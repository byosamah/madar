import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { ResourceFolder } from '../../api/contract/entities';
import type { FileView } from '../../api/contract/views';
import { newStoryId, useUndoable } from '../../app/actions';
import { tooLargeText, uploadErrorMessage, useFileLimit } from '../../app/files';
import { useLang } from '../../app/lang';
import { useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { useIsPhone } from '../../app/useIsPhone';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { HiddenMark } from '../../components/HiddenMark';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { FolderOpenIcon } from '../../components/icons/animated/folder-open';
import { PlusIcon } from '../../components/icons/animated/plus';
import { LoadFailed } from '../../components/LoadFailed';
import { Menu, type MenuItem } from '../../components/Menu';
import { ScreenControls } from '../../components/ScreenControls';
import { ScreenTitle } from '../../components/ScreenTitle';
import { replaceParam } from '../../lib/params';
import { UploadList } from '../files/Attachments';
import { FolderNameField } from '../project/files/FolderNameField';
import { PreviewSheet } from '../project/files/PreviewSheet';
import { WorkHeader } from '../work/WorkHeader';
import { MoveResourceSheet } from './MoveResourceSheet';
import { RenameFileSheet } from './RenameFileSheet';
import { ResourceFileRow } from './ResourceFileRow';

/** True when a drag carries files from the computer. The browser drags a picture of a row by itself, with no file in it. */
function carriesFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return types ? [...types].includes('Files') : true;
}

/**
 * The Resources page (fbk_078, owner 2026-11-05): the files of the whole office, such as building codes and office policies. Every person opens,
 * previews and downloads them. A person with the switch "Manage office resources" also adds, renames, moves and deletes files and folders, and sees the
 * one main button of the page: the upload. The folders are one level deep. A press on a folder opens it in place (`?folder=`, a step in the history).
 * A locked folder shows only to a holder of the switch "Locked folders", with a lock mark. The API sends nobody else the folder or its files.
 */
export function ResourcesScreen() {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const lang = useLang();
  const { api } = useRuntime();
  const toast = useToast();
  const limit = useFileLimit({ resources: true });
  const list = useCall('resources.list', {});
  const view = list.data;
  const manage = view?.viewerCan.manage === true;
  const canLock = view?.viewerCan.lock === true;
  const [params, setParams] = useSearchParams();
  const [preview, setPreview] = useState<FileView | null>(null);
  const [renaming, setRenaming] = useState<FileView | null>(null);
  const [moving, setMoving] = useState<{ view: FileView; anchor: HTMLElement | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [going, setGoing] = useState<File[]>([]);
  const [percents, setPercents] = useState<ReadonlyMap<File, number>>(() => new Map());
  const picker = useRef<HTMLInputElement>(null);
  const folders = useMemo(() => view?.folders ?? [], [view]);
  const files = useMemo(() => view?.files ?? [], [view]);
  // An open folder: a folder that the person sees. A folder that is gone, or that the person may not see, reads as none.
  const openId = params.get('folder');
  const open: ResourceFolder | undefined = openId ? folders.find((folder) => folder.id === openId) : undefined;
  const openFolder = (id: string | null) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (id === null) next.delete('folder');
    else next.set('folder', id);
    return next;
  }, { replace: id === null });

  // A link from Search (`?file=`) opens the preview of that file once, in its folder. The link part goes, so Back does not open it again.
  const linked = params.get('file');
  useEffect(() => {
    if (!linked || !view) return;
    const found = view.files.find((item) => item.file.id === linked);
    if (found) {
      setPreview(found);
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('file');
        if (found.file.folderId) next.set('folder', found.file.folderId);
        return next;
      }, { replace: true });
    } else replaceParam(setParams, 'file', null);
  }, [linked, view, setParams]);

  const createFolder = useUndoable('resources.saveFolder', { message: (folder) => (folder.locked === true ? t('folders.locked') : t('folders.created')) });
  const renameFolder = useUndoable('resources.saveFolder', { message: () => t('folders.renamed') });
  const lockFolder = useUndoable('resources.saveFolder', { message: (folder) => (folder.locked === true ? t('folders.locked') : t('folders.unlocked')) });
  const deleteFolder = useUndoable('resources.delete', { message: () => t('folders.deleted') });
  const renameFile = useUndoable('resources.updateFile', { message: () => t('resources.fileRenamed') });
  const lastPlace = useRef('');
  const moveFile = useUndoable('resources.updateFile', { message: () => t('folders.moved', { place: lastPlace.current }) });
  const moveTo = (fileId: string, folderId: string | null) => {
    lastPlace.current = folderId ? (folders.find((folder) => folder.id === folderId)?.name ?? '') : t('resources.title');
    moveFile.mutate({ id: fileId, folderId });
  };

  // A failed upload keeps its place in the queue: Retry sends that file and the ones after it, never the ones that went up.
  const uploadQueue = async (queue: File[], meta: { correlationId: string }): Promise<void> => {
    setUploading(true);
    setGoing(queue);
    setPercents(new Map(queue.map((file) => [file, 0])));
    let sent = 0;
    try {
      for (const file of queue) {
        const onProgress = (done: number, total: number) => setPercents((current) => new Map(current).set(file, total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0));
        await api.call('files.upload', { resources: true, name: file.name, blob: file, ...(open ? { folderId: open.id } : {}) }, { ...meta, onProgress });
        setPercents((current) => new Map(current).set(file, 100));
        sent += 1;
      }
      toast.show({ message: t('files.uploaded', { n: queue.length }) });
    } catch (error) {
      const rest = queue.slice(sent);
      toast.failed(error, { retry: () => void uploadQueue(rest, meta), message: uploadErrorMessage(error, queue[sent]?.name ?? '', t, lang) });
    } finally {
      setUploading(false);
      setGoing([]);
      setPercents(new Map());
    }
  };
  const upload = async (chosen: FileList | null) => {
    const picked = [...(chosen ?? [])];
    for (const file of picked.filter((item) => item.size > limit)) toast.show({ tone: 'error', message: tooLargeText(file.name, limit, t, lang) });
    const accepted = picked.filter((item) => item.size <= limit);
    if (accepted.length > 0) await uploadQueue(accepted, { correlationId: newStoryId() });
  };

  const rootFiles = files.filter((item) => !item.file.folderId || !folders.some((folder) => folder.id === item.file.folderId));
  const filesOf = (folder: ResourceFolder) => files.filter((item) => item.file.folderId === folder.id);
  const empty = view !== undefined && folders.length === 0 && files.length === 0;

  const uploadButton = manage ? (
    <Button variant="primary" className="shrink-0" disabled={uploading} onClick={() => picker.current?.click()}>
      <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
      {t('files.uploadOne')}
    </Button>
  ) : undefined;

  const folderMenu = (folder: ResourceFolder) => {
    const items: MenuItem[] = [
      { label: t('folders.rename'), onSelect: () => setRenamingFolder(folder.id), hidden: !manage },
      { label: folder.locked === true ? t('folders.unlock') : t('folders.lock'), onSelect: () => lockFolder.mutate({ id: folder.id, locked: folder.locked !== true }), hidden: !canLock },
      { label: t('folders.delete'), onSelect: () => { deleteFolder.mutate({ id: folder.id }); if (open?.id === folder.id) openFolder(null); }, hidden: !manage || folder.locked === true, destructive: true },
    ];
    return items.some((item) => !item.hidden) ? <Menu label={t('folders.actions', { name: folder.name })} items={items} sheetOnPhone /> : null;
  };

  const fileList = (shown: FileView[]) => (
    <ul className="surface flex flex-col divide-y divide-hairline rounded-card py-1">
      {shown.map((item) => (
        <ResourceFileRow
          key={item.file.id}
          view={item}
          manage={manage}
          onPreview={() => setPreview(item)}
          onRename={() => setRenaming(item)}
          onMove={(anchor) => setMoving({ view: item, anchor })}
        />
      ))}
    </ul>
  );

  const folderRow = (folder: ResourceFolder) => (
    <li key={folder.id} className="flex min-h-12 items-center gap-2 px-2">
      {renamingFolder === folder.id ? (
        <>
          <AnimatedIcon icon={FolderOpenIcon} size={18} className="shrink-0 text-ink-2" aria-hidden />
          <FolderNameField
            initial={folder.name}
            onSave={(name) => {
              setRenamingFolder(null);
              renameFolder.mutate({ id: folder.id, name });
            }}
            onCancel={() => setRenamingFolder(null)}
          />
        </>
      ) : (
        <>
          <button type="button" aria-label={t('folders.open', { name: folder.name })} onClick={() => openFolder(folder.id)} className="pressable flex min-h-11 min-w-0 flex-1 items-center gap-2 text-start">
            <AnimatedIcon icon={FolderOpenIcon} size={18} className="shrink-0 text-ink-2" aria-hidden />
            <bdi className="min-w-0 truncate text-subheadline font-semibold">{folder.name}</bdi>
            {folder.locked === true && <HiddenMark label={t('folders.lockedMark')} />}
            <span className="tabular shrink-0 text-footnote text-ink-2">{t('folders.count', { count: filesOf(folder).length })}</span>
          </button>
          {folderMenu(folder)}
        </>
      )}
    </li>
  );

  const header = phone
    ? <WorkHeader action={uploadButton} />
    : <ScreenTitle title={t('resources.title')} action={uploadButton} />;

  const body = open ? (
    <section aria-labelledby="resources-open" className="flex flex-col gap-3">
      <div className="flex min-h-11 items-center gap-2">
        <Button variant="plain" aria-label={t('folders.backLabel')} onClick={() => openFolder(null)}>{t('folders.back')}</Button>
        <h2 id="resources-open" dir="auto" className="min-w-0 truncate text-headline">{open.name}</h2>
        {open.locked === true && <HiddenMark label={t('folders.lockedMark')} />}
        <span className="flex-1" />
        {folderMenu(open)}
      </div>
      {filesOf(open).length > 0 ? fileList(filesOf(open)) : <p className="px-2 text-footnote text-ink-2">{manage && !phone ? t('folders.emptyDrag') : t('folders.empty')}</p>}
    </section>
  ) : (
    <div className="flex flex-col gap-4">
      {folders.length > 0 && <ul aria-label={t('resources.folders')} className="surface flex flex-col divide-y divide-hairline rounded-card py-1">{folders.map(folderRow)}</ul>}
      {rootFiles.length > 0 && (
        <section aria-label={t('resources.files')} className="flex flex-col gap-2">
          {folders.length > 0 && <h2 className="px-2 text-subheadline font-semibold">{t('resources.files')}</h2>}
          {fileList(rootFiles)}
        </section>
      )}
    </div>
  );

  return (
    <div
      className={`flex flex-col rounded-card ${dragging ? 'outline-2 outline-offset-4 outline-dashed outline-accent' : ''}`}
      onDragOver={phone || !manage ? undefined : (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={phone || !manage ? undefined : (event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={phone || !manage ? undefined : (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files);
      }}
    >
      {header}
      {manage && !open && (
        <ScreenControls>
          {adding ? (
            <FolderNameField
              onSave={(name) => {
                setAdding(false);
                createFolder.mutate({ name });
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <Button variant="plain" onClick={() => setAdding(true)}>{t('folders.add')}</Button>
          )}
          {!phone && !adding && <p className="text-footnote text-label-2">{t('files.drop')}</p>}
        </ScreenControls>
      )}
      {manage && (
        <input ref={picker} type="file" multiple tabIndex={-1} aria-label={t('files.upload')} disabled={uploading} className="sr-only" onChange={(event) => { void upload(event.target.files); event.target.value = ''; }} />
      )}
      <div className="flex flex-col gap-4">
        <UploadList files={going} progress={percents} />
        <LoadFailed query={list} />
        {empty ? <EmptyState title={t('resources.emptyTitle')} body={manage ? t('resources.emptyManager') : t('resources.emptyReader')} /> : view && body}
      </div>
      {preview && <PreviewSheet views={[preview]} index={0} onIndex={() => undefined} onClose={() => setPreview(null)} />}
      {renaming && <RenameFileSheet view={renaming} onSave={(name) => renameFile.mutate({ id: renaming.file.id, name })} onClose={() => setRenaming(null)} />}
      {moving && <MoveResourceSheet view={moving.view} folders={folders} anchor={moving.anchor} onPick={(folderId) => moveTo(moving.view.file.id, folderId)} onClose={() => setMoving(null)} />}
    </div>
  );
}
