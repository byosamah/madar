import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS } from '../../api/contract/limits';
import type { Attachment } from '../../api/contract/views';
import { downloadFile, isRemote, tooLargeText, useFileLimit } from '../../app/files';
import { useLang } from '../../app/lang';
import { useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { XIcon } from '../../components/icons/animated/x';
import { IconButton } from '../../components/IconButton';
import { AttachFileIcon } from '../../components/icons/animated/attach-file';

/**
 * Where the new files go. A task comment also links the file to its task. An office task has no project (projectId null). A direct chat
 * or a group has no project either, and names its chat (conversationId): its files stay in that chat (owner, 2026-10-19).
 */
export type UploadTarget = { projectId: string | null; stageId?: string | null; taskId?: string | null; conversationId?: string };

/**
 * The files on the clipboard of a paste (fbk_032, owner 2026-10-23), or an empty list when the paste is a text paste. A screenshot,
 * a picture copied from a page and a file copied in the Finder or the Explorer each give files. The Finder and the Explorer also put
 * the name of the file on the clipboard as text: that text is no real text, so the file wins. Real text beside a picture (a range of
 * cells of a sheet) pastes as text, so the paste never loses words.
 */
export function pastedFiles(data: Pick<DataTransfer, 'files' | 'getData'> | null): File[] {
  const files = [...(data?.files ?? [])];
  if (!data || files.length === 0) return [];
  const words = data.getData('text/plain').trim();
  if (words === '') return files;
  const lines = words.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.every((line) => files.some((file) => file.name === line)) ? files : [];
}

/**
 * The files a person picked for a post, a comment or a message. The files upload when the person sends,
 * and a file that went up before a failed send is not sent a second time.
 */
export function useAttachments(max: number = MAX_ATTACHMENTS, initial: File[] = []) {
  const { t } = useTranslation();
  const lang = useLang();
  const { api } = useRuntime();
  const toast = useToast();
  const limit = useFileLimit();
  const [files, setFiles] = useState<File[]>(initial);
  const uploaded = useRef(new Map<File, string>());

  const add = (list: Iterable<File> | null) => {
    const chosen = [...(list ?? [])];
    // The limit of the active store, checked when the person picks the file, so nothing starts that the store refuses.
    for (const file of chosen.filter((f) => f.size > limit)) toast.show({ tone: 'error', message: tooLargeText(file.name, limit, t, lang) });
    const accepted = chosen.filter((f) => f.size <= limit);
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
          {
            ...(target.projectId ? { projectId: target.projectId } : {}),
            ...(target.conversationId ? { conversationId: target.conversationId } : {}),
            name: file.name, blob: file, stageId: target.stageId ?? null, taskId: target.taskId ?? null,
          },
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
      <AnimatedIcon icon={AttachFileIcon} size={18} aria-hidden />
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

/** One file as a chip. A press saves the file. A deleted file shows as removed. */
export function FileChip({ file }: { file: Attachment }) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const { api } = runtime;
  const toast = useToast();
  if (file.name === null) {
    return (
      <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-footnote text-label-2">
        <AnimatedIcon icon={AttachFileIcon} size={14} aria-hidden />
        {t('attachments.removed')}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={t('attachments.download', { name: file.name })}
      onClick={() => downloadFile(api, file.id, undefined, { remote: isRemote(runtime) }).catch((error: unknown) => toast.failed(error))}
      className="pressable inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-fill px-3 text-footnote text-ink hover:bg-fill-strong"
    >
      <AnimatedIcon icon={AttachFileIcon} size={14} aria-hidden className="shrink-0" />
      <bdi className="truncate">{file.name}</bdi>
    </button>
  );
}

/** The files of a comment or a message, each as a chip. */
export function FileChips({ files }: { files: Attachment[] }) {
  const { t } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul aria-label={t('attachments.files')} className="flex flex-wrap gap-2">
      {files.map((file) => (
        <li key={file.id}>
          <FileChip file={file} />
        </li>
      ))}
    </ul>
  );
}
