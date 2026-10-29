import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../../components/icons/animated/check';
import { FolderOpenIcon } from '../../../components/icons/animated/folder-open';
import { useTranslation } from 'react-i18next';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { useIsPhone } from '../../../app/useIsPhone';
import { SheetOrPopover } from '../../../components/SheetOrPopover';
import { foldersOf, samePlace, type Place } from './fileDragSlots';
import { folderLabel } from './folderLabel';

/**
 * Where a file sits now, for the screen. A file whose folder is gone (it should not happen) counts as at the root of its stage, so no file is
 * ever hidden by a missing folder.
 */
export function placeOfFile(view: FileView, detail: ProjectDetail): Place {
  const { stageId, folderId } = view.file;
  const folder = folderId ? foldersOf(detail).find((item) => item.id === folderId && (item.stageId ?? null) === (stageId ?? null)) : undefined;
  return { stageId, folderId: folder ? folder.id : null };
}

/**
 * "Move to" (fbk_066, owner 2026-10-26): the way to move a file on a phone, where nothing drags, and with the keyboard. One list: the folders of the
 * whole project (fbk_074), then each stage with its folders under it, then "No stage". The place where the file sits now has a check mark. One press moves the file (the screen then shows a
 * toast with Undo). A Popover next to the row on a desk, a Sheet on a phone.
 */
export function MoveFileSheet({ view, detail, anchor, onPick, onClose }: {
  view: FileView; detail: ProjectDetail; anchor: HTMLElement | null; onPick: (place: Place) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const now = placeOfFile(view, detail);
  const projectFolders = foldersOf(detail).filter((folder) => folder.stageId === null);
  const choose = (place: Place) => {
    if (!samePlace(now, place)) onPick(place);
    onClose();
  };
  const row = (place: Place, label: string, key: string, folder = false) => {
    const here = samePlace(now, place);
    return (
      <li key={key}>
        <button
          type="button"
          aria-current={here ? 'true' : undefined}
          onClick={() => choose(place)}
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
    <SheetOrPopover open onOpenChange={(open) => { if (!open) onClose(); }} anchor={anchor} title={t('folders.moveTitle', { name: view.file.name })}>
      <div className="flex flex-col gap-2">
        {/* The sheet of a phone draws the title itself. */}
        {!phone && <p dir="auto" className="truncate text-headline text-ink">{t('folders.moveTitle', { name: view.file.name })}</p>}
        <ul className="-mx-1 flex max-h-[60vh] flex-col overflow-y-auto">
          {projectFolders.length > 0 && (
            <>
              <li key="project" className="px-2 pt-1 text-subheadline font-semibold text-ink">{t('folders.projectTitle')}</li>
              {projectFolders.map((folder) => row({ stageId: null, folderId: folder.id }, folderLabel(folder, t), folder.id, true))}
            </>
          )}
          {detail.stages.flatMap((stage) => [
            row({ stageId: stage.id, folderId: null }, stage.name, stage.id),
            ...foldersOf(detail).filter((folder) => folder.stageId === stage.id).map((folder) => row({ stageId: stage.id, folderId: folder.id }, folderLabel(folder, t), folder.id, true)),
          ])}
          {row({ stageId: null, folderId: null }, t('files.noStage'), 'none')}
        </ul>
      </div>
    </SheetOrPopover>
  );
}
