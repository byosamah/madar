import { useTranslation } from 'react-i18next';
import type { FileView } from '../../api/contract/views';
import type { ResourceFolder } from '../../api/contract/entities';
import { useIsPhone } from '../../app/useIsPhone';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../components/icons/animated/check';
import { FolderOpenIcon } from '../../components/icons/animated/folder-open';
import { SheetOrPopover } from '../../components/SheetOrPopover';

/**
 * "Move to" for a file of Resources (fbk_078): the root of Resources, then the folders that the person sees. The place where the file sits has a check
 * mark. One press moves the file, and the screen then shows a toast with Undo. A Popover next to the row on a desk, a Sheet on a phone.
 */
export function MoveResourceSheet({ view, folders, anchor, onPick, onClose }: {
  view: FileView; folders: readonly ResourceFolder[]; anchor: HTMLElement | null; onPick: (folderId: string | null) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const now = view.file.folderId ?? null;
  const choose = (folderId: string | null) => {
    if (folderId !== now) onPick(folderId);
    onClose();
  };
  const row = (folderId: string | null, label: string, folder: boolean) => {
    const here = folderId === now;
    return (
      <li key={folderId ?? 'root'}>
        <button
          type="button"
          aria-current={here ? 'true' : undefined}
          onClick={() => choose(folderId)}
          className={`pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-start text-subheadline ${folder ? 'ps-8' : 'font-semibold'} ${here ? 'bg-fill text-ink' : 'text-ink hover:bg-fill'}`}
        >
          {folder && <AnimatedIcon icon={FolderOpenIcon} size={16} className="shrink-0 text-ink-2" aria-hidden />}
          <bdi className="min-w-0 flex-1 truncate">{label}</bdi>
          {here && <AnimatedIcon icon={CheckIcon} size={16} className="shrink-0" aria-label={t('folders.moveHere')} />}
        </button>
      </li>
    );
  };
  return (
    <SheetOrPopover open onOpenChange={(open) => { if (!open) onClose(); }} anchor={anchor} title={t('folders.moveTitle', { name: view.file.name })} fit>
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {!phone && <p dir="auto" className="shrink-0 truncate text-headline text-ink">{t('folders.moveTitle', { name: view.file.name })}</p>}
        <ul className="-mx-1 flex max-h-[60vh] min-h-0 flex-1 flex-col overflow-y-auto">
          {row(null, t('resources.title'), false)}
          {folders.map((folder) => row(folder.id, folder.name, true))}
        </ul>
      </div>
    </SheetOrPopover>
  );
}
