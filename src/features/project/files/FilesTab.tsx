import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { ProjectLink } from '../../../api/contract/entities';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { newStoryId, useUndoable } from '../../../app/actions';
import { downloadFile, isRemote, tooLargeText, uploadErrorMessage, useFileLimit, useFileLink, usePictureTest } from '../../../app/files';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { LoadFailed } from '../../../components/LoadFailed';
import { SelectField } from '../../../components/Fields';
import { Menu, type MenuItem } from '../../../components/Menu';
import { formatDay, formatNumber, stampDay } from '../../../lib/dates';
import type { TabProps } from '../tabs';
import { canPreview, PreviewSheet } from './PreviewSheet';
import { LinkSheet, ProjectLinks, projectLinkRows } from './ProjectLinks';
import { ShareFileSheet } from './ShareFileSheet';

function FileRow({ view, detail, onPreview, onShare }: { view: FileView; detail: ProjectDetail; onPreview: () => void; onShare: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const runtime = useRuntime();
  const { api } = runtime;
  const toast = useToast();
  const [showVersions, setShowVersions] = useState(false);
  const { file, latest } = view;
  const isPicture = usePictureTest();
  const image = isPicture(latest.mimeType);
  const thumb = useFileLink(image ? file.id : null, latest.letter, 'thumb');
  const remove = useUndoable('files.delete', { message: () => t('files.deleted') });
  const cover = useUndoable('projects.update', { message: () => t('files.coverSet') });
  const delivered = useUndoable('files.markDelivered', { message: () => t('files.delivered') });
  const isCover = detail.project.coverFileId === file.id;
  // The API says who may delete the file, so the screen keeps no rule of its own (audit 2026-10-03, PRJ-16, V-20).
  const canDelete = view.canDelete;
  const size = latest.size < 1024 * 1024
    ? t('files.kb', { n: formatNumber(Math.max(1, Math.round(latest.size / 1024)), lang) })
    : t('files.mb', { n: formatNumber(latest.size / (1024 * 1024), lang, 1) });
  const download = (letter?: string) => {
    downloadFile(api, file.id, letter, { remote: isRemote(runtime) }).catch((error: unknown) => toast.failed(error));
  };
  const items: MenuItem[] = [
    { label: t('files.preview'), onSelect: onPreview, hidden: !canPreview(latest.mimeType) },
    { label: t('files.download'), onSelect: () => download() },
    { label: t('files.share'), onSelect: onShare, hidden: !detail.viewerCan.post },
    { label: t('files.markDelivered'), onSelect: () => delivered.mutate({ id: file.id }), hidden: !detail.viewerCan.post },
    { label: t('files.setCover'), onSelect: () => cover.mutate({ id: detail.project.id, patch: { coverFileId: file.id } }), hidden: !image || !detail.viewerCan.edit || isCover },
    { label: t('files.delete'), onSelect: () => remove.mutate({ id: file.id }), hidden: !canDelete, destructive: true },
  ];
  return (
    <li className="flex flex-col">
      {/* On a phone the row is a grid, and Versions goes on its own line under the name, so the name keeps most of the row.
          From sm up it is one line again (audit 2026-10-03, V-33). */}
      <div className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-2 sm:flex sm:gap-3">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-fill text-label-2">
          {thumb.url ? <img src={thumb.url} alt="" onError={thumb.onError} loading="lazy" decoding="async" className="size-full object-cover" /> : <AnimatedIcon icon={FileTextIcon} size={20} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <bdi className="truncate text-body">{file.name}</bdi>
            <span className="shrink-0 rounded-full bg-fill px-2 text-caption font-semibold text-label-2">{t('files.version', { letter: latest.letter })}</span>
            {isCover && <span className="shrink-0 rounded-full bg-fill px-2 text-caption text-label-2">{t('files.isCover')}</span>}
          </p>
          <p className="truncate text-footnote text-label-2">
            <bdi>{nameOf(view.uploader)}</bdi> · <span className="tabular">{formatDay(stampDay(latest.uploadedAt), lang)} · {size}</span>
          </p>
        </div>
        {file.versions.length > 1 && (
          <Button variant="plain" aria-expanded={showVersions} onClick={() => setShowVersions((open) => !open)} className="col-start-2 row-start-2 -ms-5 justify-self-start sm:ms-0">
            {t('files.versions')}
          </Button>
        )}
        <Menu label={t('files.actions', { name: file.name })} items={items} />
      </div>
      {showVersions && (
        <ol className="ms-14 flex flex-col pb-2">
          {[...file.versions].reverse().map((version) => (
            <li key={version.letter} className="flex min-h-11 items-center gap-3 text-footnote">
              <span className="font-semibold">{t('files.version', { letter: version.letter })}</span>
              <span className="tabular text-label-2">{formatDay(stampDay(version.uploadedAt), lang)}</span>
              <Button variant="plain" onClick={() => download(version.letter)}>{t('files.download')}</Button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * The Files & Links tab (owner, 2026-10-19): the links of the project first, then the files grouped by stage, with versions A, B, C
 * (spec 5.7). One Add button offers "Upload a file" and "Add a link". It is a menu from one button because one button is one next step,
 * and it keeps the row calm on a phone. Drop files anywhere on the tab to upload them.
 */
export function FilesTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const { api } = useRuntime();
  const toast = useToast();
  const limit = useFileLimit();
  const files = useCall('files.list', { projectId: detail.project.id });
  const [stageId, setStageId] = useState(detail.currentStage.id);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [received, setReceived] = useState(false);
  const [preview, setPreview] = useState<FileView | null>(null);
  const [sharing, setSharing] = useState<FileView | null>(null);
  // The link sheet is the one of the old About panel. A link opens it to edit, the Add menu opens it with no link.
  const [editing, setEditing] = useState<ProjectLink | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const canUpload = detail.viewerCan.post;
  // A link with "file" (from Search) opens that file's preview once. The link part goes, so Back does not open it again.
  const [params, setParams] = useSearchParams();
  const linked = params.get('file');
  useEffect(() => {
    if (!linked || !files.data) return;
    const view = files.data.find((item) => item.file.id === linked);
    if (view) setPreview(view);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      return next;
    }, { replace: true });
  }, [linked, files.data, setParams]);

  // A failed upload keeps its place in the queue: Retry sends that file and the ones after it, never the ones that went up.
  const uploadQueue = async (queue: File[], meta: { correlationId: string }): Promise<void> => {
    setUploading(true);
    let sent = 0;
    try {
      for (const file of queue) {
        await api.call('files.upload', { projectId: detail.project.id, name: file.name, blob: file, stageId: stageId || null, receivedFromClient: received }, meta);
        sent += 1;
      }
      toast.show({ message: t('files.uploaded', { n: queue.length }) });
      setReceived(false);
    } catch (error) {
      const rest = queue.slice(sent);
      toast.failed(error, { retry: () => void uploadQueue(rest, meta), message: uploadErrorMessage(error, queue[sent]?.name ?? '', t, lang) });
    } finally {
      setUploading(false);
    }
  };

  const upload = async (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    // The limit of the active store (50 MB on Supabase Storage, 250 MB on R2), checked before any upload starts (plan 2b, point 1).
    for (const file of chosen.filter((f) => f.size > limit)) toast.show({ tone: 'error', message: tooLargeText(file.name, limit, t, lang) });
    const accepted = chosen.filter((f) => f.size <= limit);
    if (accepted.length > 0) await uploadQueue(accepted, { correlationId: newStoryId() });
  };

  const openLink = (link: ProjectLink | null) => {
    setEditing(link);
    setLinkOpen(true);
  };
  const hasLinks = projectLinkRows(detail.project, '').length > 0;

  const groups = [...detail.stages.map((stage) => ({ id: stage.id as string | null, name: stage.name })), { id: null, name: t('files.noStage') }]
    .map((group) => ({ ...group, files: (files.data ?? []).filter((view) => view.file.stageId === group.id) }))
    .filter((group) => group.files.length > 0);

  // A tab with no files and no links shows one empty state, and the one Add button moves into it (it shows once, never twice).
  const empty = Boolean(files.data) && groups.length === 0 && !hasLinks;
  const add = canUpload && (
    <Menu
      label={t('files.add')}
      text={t('files.add')}
      icon={<AnimatedIcon icon={PlusIcon} size={18} aria-hidden />}
      align="start"
      triggerClassName="bg-fill text-ink hover:bg-fill-strong"
      items={[
        { label: t('files.uploadOne'), onSelect: () => picker.current?.click(), hidden: uploading },
        { label: t('links.addTitle'), onSelect: () => openLink(null) },
      ]}
    />
  );

  return (
    <div
      onDragOver={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files);
      }}
      className={`flex flex-col gap-4 rounded-card ${dragging ? 'outline-2 outline-offset-4 outline-dashed outline-accent' : ''}`}
    >
      {canUpload && (
        <div className="flex flex-wrap items-end gap-3">
          {!empty && add}
          <SelectField id="upload-stage" label={t('files.uploadStage')} value={stageId} onChange={(event) => setStageId(event.target.value)}>
            {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            <option value="">{t('files.noStage')}</option>
          </SelectField>
          <label className="flex min-h-11 items-center gap-2 text-subheadline text-ink">
            <input type="checkbox" checked={received} onChange={(event) => setReceived(event.target.checked)} className="size-5 accent-[var(--sig-from)]" />
            {t('files.receivedFromClient')}
          </label>
          <p className="pb-3 text-footnote text-label-2">{t('files.drop')}</p>
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
      {/* A list that did not load says so and offers Retry (audit 2026-10-03, PRJ-4). */}
      <LoadFailed query={files} />
      {empty && <EmptyState title={t('files.emptyTitle')} body={t('files.empty')} action={add} />}
      <ProjectLinks detail={detail} onEdit={openLink} />
      {groups.map((group) => {
        const id = `files-${group.id ?? 'none'}`;
        return (
          <section key={id} aria-labelledby={id} className="surface rounded-card p-2">
            <h3 id={id} dir="auto" className="px-2 pt-1 text-headline">{group.name}</h3>
            <ul>{group.files.map((view) => <FileRow key={view.file.id} view={view} detail={detail} onPreview={() => setPreview(view)} onShare={() => setSharing(view)} />)}</ul>
          </section>
        );
      })}
      <LinkSheet detail={detail} link={editing} open={linkOpen} onOpenChange={setLinkOpen} />
      {preview && <PreviewSheet views={[preview]} index={0} onIndex={() => undefined} onClose={() => setPreview(null)} />}
      {sharing && <ShareFileSheet view={sharing} projectId={detail.project.id} projectName={detail.project.name} onClose={() => setSharing(null)} />}
    </div>
  );
}
