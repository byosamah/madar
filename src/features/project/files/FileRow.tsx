import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useDownloadFile, usePictureTest, useFileLink } from '../../../app/files';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { PRIVATE } from '../../../app/privateMark';
import { useIsPhone } from '../../../app/useIsPhone';
import { useNearView } from '../../../app/useNearView';
import { useRight } from '../../../app/useRight';
import { Button } from '../../../components/Button';
import { Menu, type MenuItem } from '../../../components/Menu';
import { formatDay, stampDay } from '../../../lib/dates';
import { fileSizeText } from '../../../lib/fileSize';
import { FileDragContext } from './fileDragSlots';
import { canPreview } from './PreviewSheet';
import { sharePlaces } from './ShareFileSheet';

/**
 * One file of the Files & Links list. `onMove` opens "Move to" for the file, with the row as the anchor of the panel on a desk. The row is a
 * slot of the drag layer (`fileDragSlots.tsx`): a person with the upload right lifts it with the pointer on a desk (fbk_066).
 */
export function FileRow({ view, detail, onPreview, onShare, onMove }: {
  view: FileView; detail: ProjectDetail; onPreview: () => void; onShare: () => void; onMove: (anchor: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const lang = useLang();
  const nameOf = usePersonName();
  const [showVersions, setShowVersions] = useState(false);
  const { Row } = useContext(FileDragContext);
  const rowRef = useRef<HTMLLIElement>(null);
  const { file, latest } = view;
  const isPicture = usePictureTest();
  const image = isPicture(latest.mimeType);
  // The small picture asks for its link only when its row is within 400 px of the screen, as in the chat (performance audit 2026-10-21, BG-7).
  const thumbBox = useRef<HTMLSpanElement>(null);
  const near = useNearView(thumbBox);
  const thumb = useFileLink(image && near ? file.id : null, latest.letter, 'thumb');
  const remove = useUndoable('files.delete', { message: () => t('files.deleted') });
  const cover = useUndoable('projects.update', { message: () => t('files.coverSet') });
  const delivered = useUndoable('files.markDelivered', { message: () => t('files.delivered') });
  const isCover = detail.project.coverFileId === file.id;
  // The API says who may delete the file, so the screen keeps no rule of its own (audit 2026-10-03, PRJ-16, V-20).
  const canDelete = view.canDelete;
  // Share needs file.share and one place to share into (role rights version 2).
  const mayShare = useRight('file.share') && sharePlaces(detail.viewerCan, useRight('chat.direct')).length > 0;
  const size = fileSizeText(latest.size, t, lang);
  const download = useDownloadFile();
  const items: MenuItem[] = [
    { label: t('files.preview'), onSelect: onPreview, hidden: !canPreview(latest.mimeType) },
    { label: t('files.download'), onSelect: () => download(file.id) },
    { label: t('files.share'), onSelect: onShare, hidden: !mayShare },
    { label: t('files.markDelivered'), onSelect: () => delivered.mutate({ id: file.id }), hidden: !detail.viewerCan.deliver },
    { label: t('files.setCover'), onSelect: () => cover.mutate({ id: detail.project.id, patch: { coverFileId: file.id } }), hidden: !image || !detail.viewerCan.editDetails || isCover },
    // "Move to" is the way for a phone and for the keyboard; the pointer drag is the same move (fbk_066). It follows the upload right.
    { label: t('folders.moveTo'), onSelect: () => onMove(rowRef.current), hidden: detail.viewerCan.upload !== true },
    { label: t('files.delete'), onSelect: () => remove.mutate({ id: file.id }), hidden: !canDelete, destructive: true },
  ];
  const identity = (
    <>
      <span ref={image ? thumbBox : undefined} className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-fill text-label-2">
        {thumb.url ? <img src={thumb.url} alt="" draggable={false} onError={thumb.onError} loading="lazy" decoding="async" className={`${PRIVATE} size-full object-cover`} /> : <AnimatedIcon icon={FileTextIcon} size={20} aria-hidden />}
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
    </>
  );
  return (
    <Row fileId={file.id} name={file.name} liRef={rowRef} className="flex flex-col">
      {/* On a phone the row is a grid, and Versions goes on its own line under the name, so the name keeps most of the row.
          From sm up it is one line again (audit 2026-10-03, V-33). */}
      <div className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-2 sm:flex sm:gap-3">
        {/* On a phone the picture and the name are one press target that opens the preview (phone D). */}
        {phone && canPreview(latest.mimeType) ? (
          <button type="button" aria-label={t('picture.view', { name: file.name })} onClick={onPreview} className="pressable col-span-2 flex min-h-11 min-w-0 items-center gap-3 text-start">
            {identity}
          </button>
        ) : identity}
        {file.versions.length > 1 && (
          <Button variant="plain" aria-expanded={showVersions} onClick={() => setShowVersions((open) => !open)} className="col-start-2 row-start-2 -ms-5 justify-self-start sm:ms-0">
            {t('files.versions')}
          </Button>
        )}
        <Menu label={t('files.actions', { name: file.name })} items={items} sheetOnPhone />
      </div>
      {showVersions && (
        <ol className="ms-14 flex flex-col pb-2">
          {[...file.versions].reverse().map((version) => (
            <li key={version.letter} className="flex min-h-11 items-center gap-3 text-footnote">
              <span className="font-semibold">{t('files.version', { letter: version.letter })}</span>
              <span className="tabular text-label-2">{formatDay(stampDay(version.uploadedAt), lang)}</span>
              <Button variant="plain" onClick={() => download(file.id, version.letter)}>{t('files.download')}</Button>
            </li>
          ))}
        </ol>
      )}
    </Row>
  );
}
