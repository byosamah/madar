import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileView } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useFileLink, usePictureTest } from '../../app/files';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { PRIVATE } from '../../app/privateMark';
import { useDownloadFile } from '../../app/useDownloadFile';
import { useIsPhone } from '../../app/useIsPhone';
import { useNearView } from '../../app/useNearView';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../components/icons/animated/file-text';
import { Menu, type MenuItem } from '../../components/Menu';
import { formatDay, stampDay } from '../../lib/dates';
import { fileSizeText } from '../../lib/fileSize';
import { canPreview } from '../project/files/PreviewSheet';

/**
 * One file of the Resources page (fbk_078). Every person previews and downloads it. A person with the switch "Manage office resources" also renames,
 * moves and deletes it (`manage`). On a phone a press on the name opens the preview. The API says who may delete (`view.canDelete`).
 */
export function ResourceFileRow({ view, manage, onPreview, onRename, onMove }: {
  view: FileView; manage: boolean; onPreview: () => void; onRename: () => void; onMove: (anchor: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const lang = useLang();
  const nameOf = usePersonName();
  const rowRef = useRef<HTMLLIElement>(null);
  const { file, latest } = view;
  const isPicture = usePictureTest();
  const image = isPicture(latest.mimeType);
  // The small picture asks for its link only when its row is within 400 px of the screen, as in the Files tab.
  const thumbBox = useRef<HTMLSpanElement>(null);
  const near = useNearView(thumbBox);
  const thumb = useFileLink(image && near ? file.id : null, latest.letter, 'thumb');
  const remove = useUndoable('resources.delete', { message: () => t('files.deleted') });
  const download = useDownloadFile();
  const previewable = canPreview(latest.mimeType, file.name);
  const items: MenuItem[] = [
    { label: t('files.preview'), onSelect: onPreview, hidden: !previewable },
    { label: t('files.download'), onSelect: () => download(file.id) },
    { label: t('folders.rename'), onSelect: onRename, hidden: !manage },
    { label: t('folders.moveTo'), onSelect: () => onMove(rowRef.current), hidden: !manage },
    { label: t('files.delete'), onSelect: () => remove.mutate({ id: file.id }), hidden: !view.canDelete, destructive: true },
  ];
  const identity = (
    <>
      <span ref={image ? thumbBox : undefined} className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-fill text-label-2">
        {thumb.url ? <img src={thumb.url} alt="" draggable={false} onError={thumb.onError} loading="lazy" decoding="async" className={`${PRIVATE} size-full object-cover`} /> : <AnimatedIcon icon={FileTextIcon} size={20} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <bdi className="truncate text-body">{file.name}</bdi>
          {file.versions.length > 1 && <span className="shrink-0 rounded-full bg-fill px-2 text-caption font-semibold text-label-2">{t('files.version', { letter: latest.letter })}</span>}
        </p>
        <p className="truncate text-footnote text-label-2">
          <bdi>{nameOf(view.uploader)}</bdi> · <span className="tabular">{formatDay(stampDay(latest.uploadedAt), lang)} · {fileSizeText(latest.size, t, lang)}</span>
        </p>
      </div>
    </>
  );
  return (
    <li ref={rowRef} className="flex min-h-14 items-center gap-3 px-2">
      {phone && previewable ? (
        <button type="button" aria-label={t('picture.view', { name: file.name })} onClick={onPreview} className="pressable flex min-h-11 min-w-0 flex-1 items-center gap-3 text-start">
          {identity}
        </button>
      ) : <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>}
      <Menu label={t('files.actions', { name: file.name })} items={items} sheetOnPhone />
    </li>
  );
}
