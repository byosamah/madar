import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../../../app/useIsPhone';
import { isInlineVideo, useFileLink, usePictureTest } from '../../../app/files';
import { useDownloadFile } from '../../../app/useDownloadFile';
import { PRIVATE } from '../../../app/privateMark';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { ImageViewer } from '../../../components/ImageViewer';
import { VideoViewer } from '../../../components/VideoViewer';
import { Sheet } from '../../../components/Sheet';
import { lazyOverlay } from '../../../app/lazyOverlay';
import { officeKindOf, type OfficeKind } from '../../files/office/officeKind';

/**
 * The body of a Word or Excel preview loads in its own chunk, and the reading code loads in a chunk of its own beyond that (tsk_495).
 * The chunk starts when the preview of such a file opens, so a person who never opens one never loads it.
 */
const officeBody = lazyOverlay(() => import('../../files/office/OfficeBody').then((m) => m.OfficeBody));

/**
 * True for a file the preview can show: a picture, a PDF, a Word file (.docx) or an Excel file (.xlsx), or a video that the server shows
 * inline (MP4, WebM, QuickTime; owner, 2026-11-03). The name only matters for a file whose type says nothing (tsk_495). PowerPoint, .doc,
 * .xls and other videos stay a download.
 */
export const canPreview = (mimeType: string, name?: string) =>
  mimeType.startsWith('image/') || mimeType === 'application/pdf' || isInlineVideo(mimeType) || officeKindOf(mimeType, name) !== null;

/**
 * What the preview needs of a file: its id, its name, its type and the letter of the version (none means the newest). A FileView of the
 * Files tab fits. A chat message or a comment gives only the id, the name and the type, so it passes no letter (tsk_485).
 */
export type PreviewView = { file: { id: string; name: string }; latest: { letter?: string; mimeType: string; size?: number } };

type PreviewProps = { views: PreviewView[]; index: number; onIndex: (index: number) => void; onClose: () => void };

/** Previous and Next, for a preview of several views (the meeting drawings). */
function Steps({ views, index, onIndex }: Pick<PreviewProps, 'views' | 'index' | 'onIndex'>) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <Button variant="plain" disabled={index === 0} onClick={() => onIndex(index - 1)}>{t('files.previousDrawing')}</Button>
      <Button variant="plain" disabled={index === views.length - 1} onClick={() => onIndex(index + 1)}>{t('files.nextDrawing')}</Button>
    </div>
  );
}

/**
 * A picture on a phone opens in the full screen viewer (phone D): the small picture shows at once, the big one comes over it. Several
 * views get Previous picture and Next picture there, and the move can land on a PDF.
 */
function PhonePicture({ views, index, onIndex, onClose }: PreviewProps) {
  const download = useDownloadFile();
  const view = views[index];
  const small = useFileLink(view.file.id, view.latest.letter, 'thumb');
  const big = useFileLink(view.file.id, view.latest.letter, 'full');
  return (
    <ImageViewer
      open
      onClose={onClose}
      name={view.file.name}
      src={big.url}
      placeholder={small.url}
      failed={big.broken && small.broken}
      onError={big.onError}
      onPlaceholderError={small.onError}
      onDownload={() => download(view.file.id, view.latest.letter)}
      position={views.length > 1 ? { index, count: views.length, onMove: onIndex } : undefined}
    />
  );
}

/**
 * The foot of a PDF, Word or Excel preview (tsk_485, tsk_495): the steps of several views, and a quiet Download. A file opened from a chat
 * or a comment shows its content first and saves only on this press. The button asks files.link as the person, as every download does.
 */
function DownloadFoot({ views, index, onIndex }: Pick<PreviewProps, 'views' | 'index' | 'onIndex'>) {
  const { t } = useTranslation();
  const download = useDownloadFile();
  const view = views[index];
  return (
    <div className="flex w-full flex-col items-center gap-2">
      {views.length > 1 && <Steps views={views} index={index} onIndex={onIndex} />}
      <Button variant="plain" onClick={() => download(view.file.id, view.latest.letter)}>{t('files.download')}</Button>
    </div>
  );
}

/**
 * A PDF on a phone is a sheet with one real link (phone D). Safari for iPhone blocks a window that opens after a wait, so the link
 * is made after the signed link has loaded. Until then the button is off.
 */
function PhonePdf({ views, index, onIndex, onClose }: PreviewProps) {
  const { t } = useTranslation();
  const view = views[index];
  const link = useFileLink(view.file.id, view.latest.letter);
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={view.file.name} footer={<DownloadFoot views={views} index={index} onIndex={onIndex} />}>
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span data-file-icon className="grid size-16 place-items-center rounded-2xl bg-fill text-label-2">
          <AnimatedIcon icon={FileTextIcon} size={32} aria-hidden />
        </span>
        {link.url ? (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${PRIVATE} pressable signature inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-subheadline font-semibold`}
          >
            {t('phoneProject.files.openPdf')}
          </a>
        ) : link.broken ? (
          <p className="text-subheadline text-label-2">{t('files.noPreview')}</p>
        ) : (
          <Button variant="primary" disabled aria-busy>{t('phoneProject.files.openPdf')}</Button>
        )}
      </div>
    </Sheet>
  );
}

/**
 * A video (owner, 2026-11-03) plays in the full screen player, on a desk and on a phone alike, as in a chat. The player asks files.link
 * as the person, as the download does.
 */
function VideoPreview({ views, index, onClose }: PreviewProps) {
  const download = useDownloadFile();
  const view = views[index];
  const link = useFileLink(view.file.id, view.latest.letter, 'full');
  return (
    <VideoViewer
      open
      onClose={onClose}
      name={view.file.name}
      src={link.url}
      failed={link.broken}
      onError={link.onError}
      onDownload={() => download(view.file.id, view.latest.letter)}
    />
  );
}

/**
 * A Word or Excel file (tsk_495). Madar draws it in the browser, inside the sheet, on a desk and on a phone alike: a link out would send the
 * file to another viewer, and the owner wants no outside service. The reading code is in `features/files/office/`.
 */
function OfficePreview({ views, index, onIndex, onClose, kind }: PreviewProps & { kind: OfficeKind }) {
  const phone = useIsPhone();
  const view = views[index];
  const Body = officeBody.Overlay;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={view.file.name} wide center tall={phone} footer={<DownloadFoot views={views} index={index} onIndex={onIndex} />}>
      <Body key={`${view.file.id}|${view.latest.letter ?? ''}`} fileId={view.file.id} letter={view.latest.letter} name={view.file.name} kind={kind} size={view.latest.size} fill={!phone} />
    </Sheet>
  );
}

/**
 * A file preview: an image, a PDF, a Word file, an Excel file or a video. With more than one view, Previous and Next move through them. The picture test of
 * app/files decides which pictures an img tag shows: in the real build a picture that the store keeps as a download (an SVG)
 * shows the file icon and a download, and asks for no inline link (F3 repair). Any other type keeps the plain line, as before.
 * On a phone a picture opens in the full screen viewer and a PDF in a sheet with one link (phone D). The desk path above stays.
 */
export function PreviewSheet(props: PreviewProps) {
  const phone = useIsPhone();
  const isPicture = usePictureTest();
  const view = props.views[props.index];
  const type = view.latest.mimeType;
  const office = officeKindOf(type, view.file.name);
  if (office) return <OfficePreview {...props} kind={office} />;
  if (isInlineVideo(type)) return <VideoPreview {...props} />;
  if (phone && isPicture(type)) return <PhonePicture {...props} />;
  if (phone && type === 'application/pdf') return <PhonePdf {...props} />;
  return <DeskPreview {...props} />;
}

function DeskPreview({ views, index, onIndex, onClose }: PreviewProps) {
  const { t } = useTranslation();
  const download = useDownloadFile();
  const isPicture = usePictureTest();
  const view = views[index];
  const type = view.latest.mimeType;
  const picture = isPicture(type);
  const shown = picture || type === 'application/pdf';
  // Only a picture that the picture test refuses gets the icon and a download; any other type keeps the plain line.
  const refusedPicture = type.startsWith('image/') && !picture;
  const link = useFileLink(shown ? view.file.id : null, view.latest.letter);
  const url = link.url;
  let body = <p className="text-subheadline text-label-2">{t('files.noPreview')}</p>;
  if (refusedPicture) {
    body = (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span data-file-icon className="grid size-16 place-items-center rounded-2xl bg-fill text-label-2">
          <AnimatedIcon icon={FileTextIcon} size={32} aria-hidden />
        </span>
        <p className="text-subheadline text-label-2">{t('files.noPreview')}</p>
        <Button onClick={() => download(view.file.id, view.latest.letter)}>{t('files.download')}</Button>
      </div>
    );
  } else if (url && picture) {
    // The picture fits whole inside the big window, never cropped, portrait or landscape (fbk_079).
    body = (
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-white">
        <img src={url} alt={view.file.name} className={`${PRIVATE} absolute inset-0 size-full object-contain`} />
      </div>
    );
  } else if (url) body = <iframe src={url} title={view.file.name} className={`${PRIVATE} min-h-0 w-full flex-1 rounded-2xl bg-white`} />;
  // The link is still on its way: an empty box, not the line "no preview", which would flash in the big window.
  else if (shown && !link.broken) body = <div aria-busy className="min-h-0 flex-1" />;
  const footer = type === 'application/pdf' ? <DownloadFoot views={views} index={index} onIndex={onIndex} /> : views.length > 1 ? <Steps views={views} index={index} onIndex={onIndex} /> : undefined;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={view.file.name} wide center={shown} footer={footer}>
      {body}
    </Sheet>
  );
}
