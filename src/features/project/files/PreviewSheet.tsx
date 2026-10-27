import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../../../app/useIsPhone';
import type { FileView } from '../../../api/contract/views';
import { useDownloadFile, useFileLink, useFileUrl, usePictureTest } from '../../../app/files';
import { PRIVATE } from '../../../app/privateMark';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { ImageViewer } from '../../../components/ImageViewer';
import { Sheet } from '../../../components/Sheet';

/** True for a file the preview can show: a picture or a PDF. */
export const canPreview = (mimeType: string) => mimeType.startsWith('image/') || mimeType === 'application/pdf';

type PreviewProps = { views: FileView[]; index: number; onIndex: (index: number) => void; onClose: () => void };

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
 * A PDF on a phone is a sheet with one real link (phone D). Safari for iPhone blocks a window that opens after a wait, so the link
 * is made after the signed link has loaded. Until then the button is off.
 */
function PhonePdf({ views, index, onIndex, onClose }: PreviewProps) {
  const { t } = useTranslation();
  const view = views[index];
  const link = useFileLink(view.file.id, view.latest.letter);
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={view.file.name} footer={views.length > 1 ? <Steps views={views} index={index} onIndex={onIndex} /> : undefined}>
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
 * A file preview: an image or a PDF. With more than one view, Previous and Next move through them. The picture test of
 * app/files decides which pictures an img tag shows: in the real build a picture that the store keeps as a download (an SVG)
 * shows the file icon and a download, and asks for no inline link (F3 repair). Any other type keeps the plain line, as before.
 * On a phone a picture opens in the full screen viewer and a PDF in a sheet with one link (phone D). The desk path above stays.
 */
export function PreviewSheet(props: PreviewProps) {
  const phone = useIsPhone();
  const isPicture = usePictureTest();
  const type = props.views[props.index].latest.mimeType;
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
  const url = useFileUrl(shown ? view.file.id : null, view.latest.letter);
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
  } else if (url && picture) body = <img src={url} alt={view.file.name} className={`${PRIVATE} w-full rounded-2xl bg-white`} />;
  else if (url) body = <iframe src={url} title={view.file.name} className={`${PRIVATE} h-[70dvh] w-full rounded-2xl bg-white`} />;
  const footer = views.length > 1 ? <Steps views={views} index={index} onIndex={onIndex} /> : undefined;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={view.file.name} wide footer={footer}>
      {body}
    </Sheet>
  );
}
