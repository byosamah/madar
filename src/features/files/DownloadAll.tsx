import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/errors';
import { DownloadAllError, downloadAll, isRemote, type DownloadItem } from '../../app/files';
import { useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';

/** The quiet text button of this part: no fill, the link colour, and a press area of 44 px in a row of 32 px (as the reaction pills do). */
const QUIET = "pressable relative inline-flex min-h-8 max-w-full items-center self-start rounded-full px-1 text-footnote font-medium text-link after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] aria-disabled:opacity-60";

/**
 * "Download all" (owner, 2026-10-22, fbk_050): one quiet button that saves the newest version of many files as one ZIP file. It shows only
 * for two files or more. While it runs it says "Preparing 3 of 10..." and takes no second press. One file that fails stops the run: the
 * toast names the file and offers Retry. `zipName` is a function, so the day and the project key are read at the press.
 * `scope` names the group in the label for a screen reader, where one page holds several of these buttons.
 */
export function DownloadAllButton({ items, zipName, all = 'all', scope, className = '' }: {
  items: DownloadItem[];
  zipName: () => string;
  all?: 'all' | 'allFiles';
  scope?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const toast = useToast();
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const running = useRef(false);
  if (items.length < 2) return null;

  const run = async (): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setProgress({ n: 1, total: items.length });
    try {
      await downloadAll(runtime.api, items, zipName(), (n, total) => setProgress({ n, total }), { remote: isRemote(runtime) });
    } catch (error) {
      const retry = () => void run();
      if (error instanceof Error && error.name === 'ZipTooLargeError') {
        toast.failed(error, { message: t('zip.tooLarge') });
      } else if (error instanceof DownloadAllError) {
        const message = t('zip.failedFile', { name: error.fileName });
        // A refusal of the server keeps its own rule about Retry. A network or store failure is the kind that can work again.
        if (error.cause instanceof ApiError) toast.failed(error.cause, { retry, message });
        else toast.failed(new ApiError('failed', message), { retry, message });
      } else {
        toast.failed(error, { retry });
      }
    } finally {
      running.current = false;
      setProgress(null);
    }
  };

  return (
    <button
      type="button"
      aria-disabled={progress !== null}
      aria-busy={progress !== null}
      aria-label={progress === null && scope ? t('zip.allLabel', { count: items.length, name: scope }) : undefined}
      onClick={() => void run()}
      className={`${QUIET} ${className}`}
    >
      <span className="tabular truncate">{progress ? t('zip.preparing', progress) : t(`zip.${all}`, { count: items.length })}</span>
    </button>
  );
}
