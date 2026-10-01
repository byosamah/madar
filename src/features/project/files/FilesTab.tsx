import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { UploadIcon } from '../../../components/icons/animated/upload';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_FILE_BYTES } from '../../../api/contract/entities';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { newStoryId, useUndoable } from '../../../app/actions';
import { canRetry, errorMessage } from '../../../app/errors';
import { downloadFile, useFileUrl } from '../../../app/files';
import { useLang } from '../../../app/lang';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { SelectField } from '../../../components/Fields';
import { Menu, type MenuItem } from '../../../components/Menu';
import { Sheet } from '../../../components/Sheet';
import { formatDay, formatNumber, stampDay } from '../../../lib/dates';
import type { TabProps } from '../tabs';
import { ShareFileSheet } from './ShareFileSheet';

function PreviewSheet({ view, onClose }: { view: FileView; onClose: () => void }) {
  const { t } = useTranslation();
  const url = useFileUrl(view.file.id, view.latest.letter);
  const type = view.latest.mimeType;
  let body = <p className="text-subheadline text-label-2">{t('files.noPreview')}</p>;
  if (url && type.startsWith('image/')) body = <img src={url} alt={view.file.name} className="w-full rounded-2xl bg-white" />;
  else if (url && type === 'application/pdf') body = <iframe src={url} title={view.file.name} className="h-[70dvh] w-full rounded-2xl bg-white" />;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={view.file.name} wide>
      {body}
    </Sheet>
  );
}

function FileRow({ view, detail, onPreview, onShare }: { view: FileView; detail: ProjectDetail; onPreview: () => void; onShare: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { api } = useRuntime();
  const toast = useToast();
  const session = useCall('session.get', {});
  const [showVersions, setShowVersions] = useState(false);
  const { file, latest } = view;
  const image = latest.mimeType.startsWith('image/');
  const thumb = useFileUrl(image ? file.id : null, latest.letter);
  const remove = useUndoable('files.delete', { message: () => t('files.deleted') });
  const cover = useUndoable('projects.update', { message: () => t('files.coverSet') });
  const delivered = useUndoable('files.markDelivered', { message: () => t('files.delivered') });
  const isCover = detail.project.coverFileId === file.id;
  const canDelete = detail.viewerCan.review || file.versions[0].uploadedBy === session.data?.authority.id;
  const size = latest.size < 1024 * 1024
    ? t('files.kb', { n: formatNumber(Math.max(1, Math.round(latest.size / 1024)), lang) })
    : t('files.mb', { n: formatNumber(latest.size / (1024 * 1024), lang, 1) });
  const download = (letter?: string) => {
    downloadFile(api, file.id, letter).catch((error: unknown) => toast.show({ tone: 'error', message: errorMessage(error, t) }));
  };
  const items: MenuItem[] = [
    { label: t('files.preview'), onSelect: onPreview, hidden: !(image || latest.mimeType === 'application/pdf') },
    { label: t('files.download'), onSelect: () => download() },
    { label: t('files.share'), onSelect: onShare, hidden: !detail.viewerCan.post },
    { label: t('files.markDelivered'), onSelect: () => delivered.mutate({ id: file.id }), hidden: !detail.viewerCan.post },
    { label: t('files.setCover'), onSelect: () => cover.mutate({ id: detail.project.id, patch: { coverFileId: file.id } }), hidden: !image || !detail.viewerCan.edit || isCover },
    { label: t('files.delete'), onSelect: () => remove.mutate({ id: file.id }), hidden: !canDelete, destructive: true },
  ];
  return (
    <li className="flex flex-col">
      <div className="flex min-h-14 items-center gap-3 px-2">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-fill text-label-2">
          {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <AnimatedIcon icon={FileTextIcon} size={20} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <bdi className="truncate text-body">{file.name}</bdi>
            <span className="shrink-0 rounded-full bg-fill px-2 text-caption font-semibold text-label-2">{t('files.version', { letter: latest.letter })}</span>
            {isCover && <span className="shrink-0 rounded-full bg-fill px-2 text-caption text-label-2">{t('files.isCover')}</span>}
          </p>
          <p className="truncate text-footnote text-label-2">
            <bdi>{view.uploader.name}</bdi> · <span className="tabular">{formatDay(stampDay(latest.uploadedAt), lang)} · {size}</span>
          </p>
        </div>
        {file.versions.length > 1 && (
          <Button variant="plain" aria-expanded={showVersions} onClick={() => setShowVersions((open) => !open)}>{t('files.versions')}</Button>
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

/** Files grouped by stage, with versions A, B, C (spec 5.7). Drop files anywhere on the tab to upload them. */
export function FilesTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const files = useCall('files.list', { projectId: detail.project.id });
  const [stageId, setStageId] = useState(detail.currentStage.id);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [received, setReceived] = useState(false);
  const [preview, setPreview] = useState<FileView | null>(null);
  const [sharing, setSharing] = useState<FileView | null>(null);
  const canUpload = detail.viewerCan.post;

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
      toast.show({
        tone: 'error',
        message: errorMessage(error, t),
        action: canRetry(error) ? { label: t('common.retry'), run: () => void uploadQueue(rest, meta) } : undefined,
      });
    } finally {
      setUploading(false);
    }
  };

  const upload = async (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    for (const file of chosen.filter((f) => f.size > MAX_FILE_BYTES)) toast.show({ tone: 'error', message: t('files.tooBig', { name: file.name }) });
    const accepted = chosen.filter((f) => f.size <= MAX_FILE_BYTES);
    if (accepted.length > 0) await uploadQueue(accepted, { correlationId: newStoryId() });
  };

  const groups = [...detail.stages.map((stage) => ({ id: stage.id as string | null, name: stage.name })), { id: null, name: t('files.noStage') }]
    .map((group) => ({ ...group, files: (files.data ?? []).filter((view) => view.file.stageId === group.id) }))
    .filter((group) => group.files.length > 0);

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
          <label className="pressable inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-fill px-5 text-subheadline font-semibold text-ink hover:bg-fill-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
            <AnimatedIcon icon={UploadIcon} size={18} aria-hidden />
            {t('files.upload')}
            <input
              type="file"
              multiple
              disabled={uploading}
              className="sr-only"
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
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
      {files.data && groups.length === 0 && <EmptyState title={t('files.emptyTitle')} body={t('files.empty')} />}
      {groups.map((group) => {
        const id = `files-${group.id ?? 'none'}`;
        return (
          <section key={id} aria-labelledby={id} className="surface rounded-card p-2">
            <h3 id={id} dir="auto" className="px-2 pt-1 text-headline">{group.name}</h3>
            <ul>{group.files.map((view) => <FileRow key={view.file.id} view={view} detail={detail} onPreview={() => setPreview(view)} onShare={() => setSharing(view)} />)}</ul>
          </section>
        );
      })}
      {preview && <PreviewSheet view={preview} onClose={() => setPreview(null)} />}
      {sharing && <ShareFileSheet view={sharing} projectId={detail.project.id} onClose={() => setSharing(null)} />}
    </div>
  );
}
