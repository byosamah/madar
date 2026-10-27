import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { ProjectLink } from '../../../api/contract/entities';
import type { FileView } from '../../../api/contract/views';
import { newStoryId, useUndoable } from '../../../app/actions';
import { tooLargeText, uploadErrorMessage, useFileLimit } from '../../../app/files';
import { useLang } from '../../../app/lang';
import { useCall, useRuntime } from '../../../app/runtime';
import { useIsPhone } from '../../../app/useIsPhone';
import { usePointerCoarse } from '../../../app/usePointerCoarse';
import { useToast } from '../../../app/toasts';
import { EmptyState } from '../../../components/EmptyState';
import { LoadFailed } from '../../../components/LoadFailed';
import { SelectField } from '../../../components/Fields';
import { Menu } from '../../../components/Menu';
import { UploadList } from '../../files/Attachments';
import { tabButtonShows } from '../mainButton';
import { DownloadAllButton } from '../../files/DownloadAll';
import { replaceParam } from '../../../lib/params';
import { shownKey, shownName } from '../../../lib/projectLabel';
import type { TabProps } from '../tabs';
import { useLayerSwap } from '../tasks/lazyLayer';
import { FileGroups, groupsOf, hasContent, itemsOf, type GroupActions } from './FileGroups';
import { foldersOf, placeKey, type Place } from './fileDragSlots';
import { loadedFilesDrag, loadFilesDrag } from './filesDragLoader';
import { MoveFileSheet, placeOfFile } from './MoveFileSheet';
import { PreviewSheet } from './PreviewSheet';
import { LinkSheet, ProjectLinks, projectLinkRows } from './ProjectLinks';
import { ShareFileSheet } from './ShareFileSheet';

const filesDrag = { loaded: loadedFilesDrag, load: loadFilesDrag };

/**
 * True when a drag carries files from the computer. The browser drags a picture of a row by itself, with no file in it, and that drag must
 * never start the drop zone. A test event with no list of types counts as a file drag.
 */
function carriesFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return types ? [...types].includes('Files') : true;
}

/**
 * The Files & Links tab (owner, 2026-10-19): the links of the project first, then the files grouped by stage, with versions A, B, C
 * (spec 5.7). One Add button offers "Upload a file" and "Add a link". It is a menu from one button because one button is one next step,
 * and it keeps the row calm on a phone. Drop files anywhere on the tab to upload them.
 */
export function FilesTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const coarse = usePointerCoarse();
  const lang = useLang();
  const { api } = useRuntime();
  const toast = useToast();
  const limit = useFileLimit();
  const files = useCall('files.list', { projectId: detail.project.id });
  const [stageId, setStageId] = useState(detail.currentStage.id);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  // The files of the queue that is going up, each with its whole percent (fbk_045). The list is empty when nothing goes up.
  const [going, setGoing] = useState<File[]>([]);
  const [percents, setPercents] = useState<ReadonlyMap<File, number>>(() => new Map());
  // The same Map when the percent did not change, so React skips the render.
  const setPercent = (file: File, percent: number) => setPercents((current) => (current.get(file) === percent ? current : new Map(current).set(file, percent)));
  const [received, setReceived] = useState(false);
  const [preview, setPreview] = useState<FileView | null>(null);
  const [sharing, setSharing] = useState<FileView | null>(null);
  // "Move to" (fbk_066): the file and the row that anchors the panel on a desk.
  const [moving, setMoving] = useState<{ view: FileView; anchor: HTMLElement | null } | null>(null);
  // The place that a file from the computer is over (native drag and drop): its zone shows a frame.
  const [fileOver, setFileOver] = useState<string | null>(null);
  // The link sheet is the one of the old About panel. A link opens it to edit, the Add menu opens it with no link.
  const [editing, setEditing] = useState<ProjectLink | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const canUpload = detail.viewerCan.upload === true;
  const canLink = detail.viewerCan.links === true;
  const canDeliver = detail.viewerCan.deliver === true;
  // A link with "file" (from Search) opens that file's preview once. The link part goes, so Back does not open it again.
  const [params, setParams] = useSearchParams();
  const linked = params.get('file');
  useEffect(() => {
    if (!linked || !files.data) return;
    const view = files.data.find((item) => item.file.id === linked);
    if (view) setPreview(view);
    replaceParam(setParams, 'file', null);
  }, [linked, files.data, setParams]);

  // A failed upload keeps its place in the queue: Retry sends that file and the ones after it, never the ones that went up.
  const uploadQueue = async (queue: File[], meta: { correlationId: string }, place?: Place): Promise<void> => {
    setUploading(true);
    setGoing(queue);
    setPercents(new Map(queue.map((file) => [file, 0])));
    let sent = 0;
    try {
      for (const file of queue) {
        const onProgress = (done: number, total: number) => setPercent(file, total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);
        // A file dropped on a folder or a stage group goes there (fbk_066). Any other file goes to the stage of the select, at the root.
        const where = place ? { stageId: place.stageId, ...(place.folderId ? { folderId: place.folderId } : {}) } : { stageId: stageId || null };
        await api.call('files.upload', { projectId: detail.project.id, name: file.name, blob: file, ...where, receivedFromClient: received }, { ...meta, onProgress });
        setPercent(file, 100);
        sent += 1;
      }
      toast.show({ message: t('files.uploaded', { n: queue.length }) });
      setReceived(false);
    } catch (error) {
      const rest = queue.slice(sent);
      toast.failed(error, { retry: () => void uploadQueue(rest, meta, place), message: uploadErrorMessage(error, queue[sent]?.name ?? '', t, lang) });
    } finally {
      setUploading(false);
      setGoing([]);
      // Clear the percents, so the Map does not keep the File objects of finished uploads.
      setPercents(new Map());
    }
  };

  const upload = async (list: FileList | null, place?: Place) => {
    const chosen = [...(list ?? [])];
    // The limit of the active store (50 MB on Supabase Storage, 250 MB on R2), checked before any upload starts (plan 2b, point 1).
    for (const file of chosen.filter((f) => f.size > limit)) toast.show({ tone: 'error', message: tooLargeText(file.name, limit, t, lang) });
    const accepted = chosen.filter((f) => f.size <= limit);
    if (accepted.length > 0) await uploadQueue(accepted, { correlationId: newStoryId() }, place);
  };

  const openLink = (link: ProjectLink | null) => {
    setEditing(link);
    setLinkOpen(true);
  };
  const hasLinks = projectLinkRows(detail.project, '').length > 0;

  // A person who may upload also sees the stages with nothing: "+ Folder" sits in the heading row of its stage (fbk_066). A tab with no file, no
  // folder and no link shows the empty state alone. A file or a folder of a stage that is gone fills no group, but it still opens the empty stages.
  // The groups wait for the list of files: a folder never shows "No files yet." while its files load.
  const noStage = t('files.noStage');
  const { groups, empty } = useMemo(() => {
    if (!files.data) return { groups: [], empty: false };
    const showEmptyStages = canUpload && (files.data.length > 0 || foldersOf(detail).length > 0 || hasLinks);
    const built = groupsOf(detail, files.data, showEmptyStages, noStage);
    return { groups: built, empty: !hasLinks && !built.some(hasContent) };
  }, [detail, files.data, canUpload, hasLinks, noStage]);

  // "Download all" (owner, 2026-10-22, fbk_050): the newest version of each file, for one stage and for the whole project. A button shows for two files
  // or more. The whole-project button shows only when the files sit in more than one group, because with one group it would repeat the group button.
  const allItems = itemsOf(files.data ?? []);
  const projectZip = () => `${shownKey(detail.project, t)} ${shownName(detail.project, lang)}`;

  const stageName = (stageId: string | null) => (stageId === null ? noStage : (detail.stages.find((stage) => stage.id === stageId)?.name ?? ''));
  const placeText = (place: Place): string => {
    const folder = place.folderId ? foldersOf(detail).find((item) => item.id === place.folderId) : undefined;
    return folder ? t('folders.placeIn', { stage: stageName(place.stageId), folder: folder.name }) : stageName(place.stageId);
  };
  const viewOf = (id: string) => (files.data ?? []).find((view) => view.file.id === id);
  const nameOfFile = (id: string) => viewOf(id)?.file.name ?? '';
  const placeOfId = (id: string): Place | undefined => {
    const view = viewOf(id);
    return view ? placeOfFile(view, detail) : undefined;
  };

  // The folder calls and the move. One call for each, so one Undo takes each back (fbk_066). Delete asks nothing: the Undo is the way back.
  const lastPlace = useRef('');
  const createFolder = useUndoable('folders.create', { message: () => t('folders.created') });
  const renameFolder = useUndoable('folders.rename', { message: () => t('folders.renamed') });
  const deleteFolder = useUndoable('folders.delete', { message: () => t('folders.deleted') });
  const move = useUndoable('files.move', { message: () => t('folders.moved', { place: lastPlace.current }) });
  const moveTo = (fileId: string, place: Place) => {
    lastPlace.current = placeText(place);
    move.mutate({ id: fileId, stageId: place.stageId, folderId: place.folderId });
  };

  // The pointer drag is for a desk with a fine pointer, and for a person who may upload. The layer starts to load when the tab opens, so the swap
  // from the static list happens once, early, and not when the files arrive.
  const dragOn = !phone && !coarse && canUpload;
  const Host = useLayerSwap(filesDrag, dragOn);

  // A file from the computer dropped on a stage group or a folder goes there; the frame follows the pointer. The place under the pointer wins.
  const zoneOf: GroupActions['zoneOf'] = (place) => {
    if (phone || !canUpload) return {};
    const key = placeKey(place);
    return {
      framed: fileOver === key,
      native: {
        onDragOver: (event: DragEvent<HTMLElement>) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          setFileOver(key);
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileOver((current) => (current === key ? null : current));
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setFileOver(null);
          void upload(event.dataTransfer.files, place);
        },
      },
    };
  };
  const actions: GroupActions = {
    canUpload,
    onPreview: setPreview,
    onShare: setSharing,
    onMove: (view, anchor) => setMoving({ view, anchor }),
    createFolder: (stage, name) => createFolder.mutate({ projectId: detail.project.id, stageId: stage, name }),
    renameFolder: (id, name) => renameFolder.mutate({ id, name }),
    deleteFolder: (id) => deleteFolder.mutate({ id }),
    zoneOf,
  };

  // A tab with no files and no links shows one empty state, and the one Add button moves into it (it shows once, never twice).
  const add = (canUpload || canLink) && (
    <Menu
      label={t('files.add')}
      text={t('files.add')}
      icon={<AnimatedIcon icon={PlusIcon} size={18} aria-hidden />}
      align="start"
      sheetOnPhone
      // The Add button is the one navy button of this tab on a phone, when it shows (phone D).
      triggerClassName={phone && tabButtonShows('files', detail.viewerCan) ? 'signature enabled:hover:brightness-110' : 'bg-fill text-ink hover:bg-fill-strong'}
      items={[
        { label: t('files.uploadOne'), onSelect: () => picker.current?.click(), hidden: uploading || !canUpload },
        { label: t('links.addTitle'), onSelect: () => openLink(null), hidden: !canLink },
      ]}
    />
  );

  const tab = (
    <div
      // A phone has no drag from outside, so it takes no drop and draws no frame. Only a file from the computer counts: a picture of a row
      // that the browser drags by itself, and a row that the drag layer lifts, never start the drop zone (fbk_066).
      onDragOver={phone ? undefined : (event) => {
        if (!canUpload || !carriesFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={phone ? undefined : (event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={phone ? undefined : (event) => {
        if (!canUpload || !carriesFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files);
      }}
      className={`flex flex-col gap-4 rounded-card ${dragging ? 'outline-2 outline-offset-4 outline-dashed outline-accent' : ''}`}
    >
      {(canUpload || canLink) && (
        <div className="flex flex-wrap items-end gap-3">
          {!empty && add}
          {canUpload && <SelectField id="upload-stage" label={t('files.uploadStage')} value={stageId} onChange={(event) => setStageId(event.target.value)}>
            {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            <option value="">{t('files.noStage')}</option>
          </SelectField>}
          {/* "Received from the client" also writes a Tracker line, so it needs file.deliver (role rights version 2). */}
          {canUpload && canDeliver && (
            <label className="flex min-h-11 items-center gap-2 text-subheadline text-ink">
              <input type="checkbox" checked={received} onChange={(event) => setReceived(event.target.checked)} className="size-5 accent-[var(--sig-from)]" />
              {t('files.receivedFromClient')}
            </label>
          )}
          {canUpload && !phone && <p className="pb-3 text-footnote text-label-2">{t('files.drop')}</p>}
        </div>
      )}
      {/* The file chooser opens from the menu item "Upload a file". The input stays here, out of the tab order, so a file that is dropped
          on the tab and a file that is chosen go the same way. */}
      {canUpload && (
        <input
          ref={picker}
          type="file"
          multiple
          tabIndex={-1}
          aria-label={t('files.upload')}
          disabled={uploading}
          className="sr-only"
          onChange={(event) => {
            void upload(event.target.files);
            event.target.value = '';
          }}
        />
      )}
      <UploadList files={going} progress={percents} />
      {/* A list that did not load says so and offers Retry (audit 2026-10-03, PRJ-4). */}
      <LoadFailed query={files} />
      {empty && <EmptyState title={t('files.emptyTitle')} body={t('files.empty')} action={add} />}
      <ProjectLinks detail={detail} onEdit={openLink} />
      {groups.filter((group) => group.total > 0).length > 1 && <DownloadAllButton items={allItems} zipName={projectZip} all="allFiles" className="px-2" />}
      <FileGroups groups={groups} detail={detail} actions={actions} />
      <LinkSheet detail={detail} link={editing} open={linkOpen} onOpenChange={setLinkOpen} />
      {preview && <PreviewSheet views={[preview]} index={0} onIndex={() => undefined} onClose={() => setPreview(null)} />}
      {sharing && <ShareFileSheet view={sharing} projectId={detail.project.id} projectName={shownName(detail.project, lang)} viewerCan={detail.viewerCan} onClose={() => setSharing(null)} />}
      {moving && <MoveFileSheet view={moving.view} detail={detail} anchor={moving.anchor} onPick={(place) => moveTo(moving.view.file.id, place)} onClose={() => setMoving(null)} />}
    </div>
  );
  // The pointer drag (dnd-kit) is a chunk of its own: the tab first draws the static list, and the layer takes its place once it has loaded.
  return dragOn && Host ? <Host nameOf={nameOfFile} placeText={placeText} placeOf={placeOfId} onMove={moveTo}>{tab}</Host> : tab;
}
