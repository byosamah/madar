import { useEffect, useRef, useState } from 'react';
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
 * or a group has no project either, and names its chat (conversationId): its files stay in that chat (owner, 2026-10-19). The minutes of
 * a meeting with no project name their meeting (meetingId): the files stay with that meeting (wave 2).
 */
export type UploadTarget = { projectId: string | null; stageId?: string | null; taskId?: string | null; conversationId?: string; meetingId?: string };

/**
 * The pictures of a paste, or an empty list (chat design 2026-10-19, item 14). A paste that holds text stays text. A paste of only
 * pictures adds them as picked files. The chat box (Composer.tsx) and the comment box of the task panel (CommentThread.tsx, fbk_032)
 * use this one rule.
 */
export function pastedPictures(data: Pick<DataTransfer, 'files' | 'getData'> | null): File[] {
  if (!data || data.getData('text/plain') !== '') return [];
  return [...data.files].filter((file) => file.type.startsWith('image/'));
}

/** True when a drag carries files. A drag of selected text or of a link carries none, and the page leaves it alone. */
const dragHasFiles = (event: DragEvent): boolean => [...(event.dataTransfer?.types ?? [])].includes('Files');

/**
 * A file dropped on a page opens in the browser tab, and the person loses the page and the draft (fbk_030). While this runs, a drag of
 * files over the page is not left to the browser, and the cursor says "not here". A drop area (ChatDropArea of the chat or of the task
 * panel) takes the drag first and cancels its default: this leaves that drag alone, so the area keeps its own cursor and its drop.
 */
export function useBlockFileDrop(): void {
  useEffect(() => {
    const keep = (event: DragEvent) => {
      if (!dragHasFiles(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', keep);
    window.addEventListener('drop', keep);
    return () => {
      window.removeEventListener('dragover', keep);
      window.removeEventListener('drop', keep);
    };
  }, []);
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
  // The whole percent of each file that is on its way (0 to 100). A file with no entry shows no bar.
  const [progress, setProgress] = useState<ReadonlyMap<File, number>>(() => new Map());
  const [uploading, setUploading] = useState(false);
  const setPercent = (file: File, percent: number | null) => setProgress((current) => {
    const next = new Map(current);
    if (percent === null) next.delete(file);
    else next.set(file, percent);
    return next;
  });

  const add = (list: FileList | readonly File[] | null) => {
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
    setUploading(true);
    // Each file that still has to go up shows its bar at 0 from the start, so the person sees all of them.
    for (const file of files) if (!uploaded.current.has(file)) setPercent(file, 0);
    try {
      for (const file of files) {
        let id = uploaded.current.get(file);
        if (!id) {
          try {
            const view = await api.call(
              'files.upload',
              {
                ...(target.projectId ? { projectId: target.projectId } : {}),
                ...(target.conversationId ? { conversationId: target.conversationId } : {}),
                ...(target.meetingId ? { meetingId: target.meetingId } : {}),
                name: file.name, blob: file, stageId: target.stageId ?? null, taskId: target.taskId ?? null,
              },
              { ...meta, onProgress: (sent, total) => setPercent(file, total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0) },
            );
            id = view.file.id;
            uploaded.current.set(file, id);
            setPercent(file, 100);
          } catch (error) {
            // A file that failed shows no bar, so the chip is as it was before the send.
            setPercent(file, null);
            throw error;
          }
        }
        ids.push(id);
      }
      return ids;
    } finally {
      setUploading(false);
      // A file that was not tried (an earlier file failed) shows no bar either.
      for (const file of files) if (!uploaded.current.has(file)) setPercent(file, null);
    }
  };

  const clear = () => {
    setFiles([]);
    uploaded.current.clear();
    setProgress(new Map());
  };

  const remove = (index: number) => {
    const gone = files[index];
    if (gone) setPercent(gone, null);
    setFiles((list) => list.filter((_, i) => i !== index));
  };

  return { files, add, upload, clear, remove, progress, uploading, full: files.length >= max };
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

/**
 * The picked files, each with a button that takes it out again. A file on its way shows a thin grey bar under its name (chat design
 * 2026-10-19, item 14), still and in no colour of attention. While `busy` is true the Remove buttons are locked, so a file that is going up
 * cannot be taken out.
 */
export function PickedFiles({ files, onRemove, progress, busy = false }: { files: File[]; onRemove: (index: number) => void; progress?: ReadonlyMap<File, number>; busy?: boolean }) {
  const { t } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul aria-label={t('attachments.picked')} className="flex flex-wrap gap-2">
      {files.map((file, i) => (
        <li key={`${file.name}-${i}`} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-fill ps-3">
          <span className="flex min-w-0 flex-col gap-1">
            <bdi className="text-footnote">{file.name}</bdi>
            {progress?.has(file) && <UploadBar name={file.name} percent={progress.get(file) ?? 0} />}
          </span>
          <IconButton label={t('attachments.remove', { name: file.name })} disabled={busy} onClick={() => onRemove(i)}>
            <AnimatedIcon icon={XIcon} size={14} aria-hidden />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

/** The thin grey bar of a file that goes up: the whole percent, in words for a screen reader. Every upload spot uses this one bar (fbk_045). */
export function UploadBar({ name, percent }: { name: string; percent: number }) {
  const { t } = useTranslation();
  return <BarBox label={t('chat.uploading', { name, percent })} percent={percent} />;
}

/** The bar with a label that the caller words, for a group of files with one bar (the screenshots of a report). */
export function BarBox({ label, percent }: { label: string; percent: number }) {
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
      className="block h-[3px] w-full min-w-30 overflow-hidden rounded-full bg-fill-strong"
    >
      <span className="block h-full rounded-full bg-ink-2" style={{ width: `${percent}%` }} />
    </span>
  );
}

/**
 * The files that go up in a queue with no Remove button (the Files tab): each name has its bar. A file that waits shows its bar at 0.
 */
export function UploadList({ files, progress }: { files: File[]; progress: ReadonlyMap<File, number> }) {
  const { t } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul aria-label={t('files.going')} className="flex flex-wrap gap-2">
      {files.map((file, i) => (
        <li key={`${file.name}-${i}`} className="inline-flex min-h-11 min-w-0 max-w-full items-center rounded-full bg-fill px-3">
          <span className="flex min-w-0 flex-col gap-1">
            <bdi className="truncate text-footnote">{file.name}</bdi>
            <UploadBar name={file.name} percent={progress.get(file) ?? 0} />
          </span>
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

/**
 * The files of a comment or a message, each as a chip. The list and each item may shrink below the width of the file name
 * (`min-w-0 max-w-full`), so the chip stays inside its bubble and cuts a long name with an ellipsis (fbk_040).
 */
export function FileChips({ files }: { files: Attachment[] }) {
  const { t } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul aria-label={t('attachments.files')} className="flex min-w-0 max-w-full flex-wrap gap-2">
      {files.map((file) => (
        <li key={file.id} className="min-w-0 max-w-full">
          <FileChip file={file} />
        </li>
      ))}
    </ul>
  );
}
