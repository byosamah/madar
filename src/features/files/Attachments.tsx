import { Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS, MAX_FILE_BYTES } from '../../api/contract/entities';
import type { Attachment } from '../../api/contract/views';
import { errorMessage } from '../../app/errors';
import { downloadFile } from '../../app/files';
import { useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { XIcon } from '../../components/icons/animated/x';
import { IconButton } from '../../components/IconButton';

/** Where the new files go. A task comment also links the file to its task. */
export type UploadTarget = { projectId: string; stageId?: string | null; taskId?: string | null };

/**
 * The files a person picked for a post, a comment or a message. The files upload when the person sends,
 * and a file that went up before a failed send is not sent a second time.
 */
export function useAttachments(max: number = MAX_ATTACHMENTS) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const uploaded = useRef(new Map<File, string>());

  const add = (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    for (const file of chosen.filter((f) => f.size > MAX_FILE_BYTES)) toast.show({ tone: 'error', message: t('files.tooBig', { name: file.name }) });
    const accepted = chosen.filter((f) => f.size <= MAX_FILE_BYTES);
    const room = Math.max(0, max - files.length);
    if (accepted.length > room) toast.show({ tone: 'error', message: t('attachments.tooMany', { count: max }) });
    setFiles((current) => [...current, ...accepted.slice(0, room)]);
  };

  /** Uploads every picked file and returns the file ids. It throws when an upload fails. */
  const upload = async (target: UploadTarget, meta?: { correlationId: string }): Promise<string[]> => {
    const ids: string[] = [];
    for (const file of files) {
      let id = uploaded.current.get(file);
      if (!id) {
        const view = await api.call(
          'files.upload',
          { projectId: target.projectId, name: file.name, blob: file, stageId: target.stageId ?? null, taskId: target.taskId ?? null },
          meta,
        );
        id = view.file.id;
        uploaded.current.set(file, id);
      }
      ids.push(id);
    }
    return ids;
  };

  const clear = () => {
    setFiles([]);
    uploaded.current.clear();
  };

  return { files, add, upload, clear, remove: (index: number) => setFiles((list) => list.filter((_, i) => i !== index)), full: files.length >= max };
}

/** The "Attach files" control. The compact form is a round icon button, for the chat box. */
export function AttachButton({ onPick, compact = false, disabled = false }: { onPick: (list: FileList | null) => void; compact?: boolean; disabled?: boolean }) {
  const { t } = useTranslation();
  const shape = compact ? 'size-11 justify-center rounded-full text-label-2' : 'min-h-11 gap-2 rounded-full px-3 text-subheadline font-semibold text-link';
  return (
    <label className={`pressable inline-flex shrink-0 cursor-pointer items-center hover:bg-fill has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${shape}`}>
      <Paperclip size={18} aria-hidden />
      <span className={compact ? 'sr-only' : undefined}>{t('attachments.attach')}</span>
      <input
        type="file"
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          onPick(event.target.files);
          event.target.value = '';
        }}
      />
    </label>
  );
}

/** The picked files, each with a button that takes it out again. */
export function PickedFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  const { t } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul aria-label={t('attachments.picked')} className="flex flex-wrap gap-2">
      {files.map((file, i) => (
        <li key={`${file.name}-${i}`} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-fill ps-3">
          <bdi className="text-footnote">{file.name}</bdi>
          <IconButton label={t('attachments.remove', { name: file.name })} onClick={() => onRemove(i)}>
            <AnimatedIcon icon={XIcon} size={14} aria-hidden />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

/** The files of a comment or a message. A chip saves the file. A deleted file shows as removed. */
export function FileChips({ files }: { files: Attachment[] }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  if (files.length === 0) return null;
  return (
    <ul aria-label={t('attachments.files')} className="flex flex-wrap gap-2">
      {files.map((file) => (
        <li key={file.id}>
          {file.name === null ? (
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-footnote text-label-2">
              <Paperclip size={14} aria-hidden />
              {t('attachments.removed')}
            </span>
          ) : (
            <button
              type="button"
              aria-label={t('attachments.download', { name: file.name })}
              onClick={() => downloadFile(api, file.id).catch((error: unknown) => toast.show({ tone: 'error', message: errorMessage(error, t) }))}
              className="pressable inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-fill px-3 text-footnote text-ink hover:bg-fill-strong"
            >
              <Paperclip size={14} aria-hidden className="shrink-0" />
              <bdi className="truncate">{file.name}</bdi>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
