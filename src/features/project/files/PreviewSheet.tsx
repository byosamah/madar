import { useTranslation } from 'react-i18next';
import type { FileView } from '../../../api/contract/views';
import { errorMessage } from '../../../app/errors';
import { downloadFile, isRemote, useFileUrl, usePictureTest } from '../../../app/files';
import { useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { Sheet } from '../../../components/Sheet';

/** True for a file the preview can show: a picture or a PDF. */
export const canPreview = (mimeType: string) => mimeType.startsWith('image/') || mimeType === 'application/pdf';

/**
 * A file preview: an image or a PDF. With more than one view, Previous and Next move through them. The picture test of
 * app/files decides which pictures an img tag shows: in the real build a picture that the store keeps as a download (an SVG)
 * shows the file icon and a download, and asks for no inline link (F3 repair).
 */
export function PreviewSheet({ views, index, onIndex, onClose }: { views: FileView[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const toast = useToast();
  const isPicture = usePictureTest();
  const view = views[index];
  const type = view.latest.mimeType;
  const picture = isPicture(type);
  const shown = picture || type === 'application/pdf';
  const url = useFileUrl(shown ? view.file.id : null, view.latest.letter);
  const download = () => {
    downloadFile(runtime.api, view.file.id, view.latest.letter, { remote: isRemote(runtime) })
      .catch((error: unknown) => toast.show({ tone: 'error', message: errorMessage(error, t) }));
  };
  let body = <p className="text-subheadline text-label-2">{t('files.noPreview')}</p>;
  if (!shown) {
    body = (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span data-file-icon className="grid size-16 place-items-center rounded-2xl bg-fill text-label-2">
          <AnimatedIcon icon={FileTextIcon} size={32} aria-hidden />
        </span>
        <p className="text-subheadline text-label-2">{t('files.noPreview')}</p>
        <Button onClick={download}>{t('files.download')}</Button>
      </div>
    );
  } else if (url && picture) body = <img src={url} alt={view.file.name} className="w-full rounded-2xl bg-white" />;
  else if (url) body = <iframe src={url} title={view.file.name} className="h-[70dvh] w-full rounded-2xl bg-white" />;
  const footer = views.length > 1 && (
    <div className="flex w-full items-center justify-between gap-3">
      <Button variant="plain" disabled={index === 0} onClick={() => onIndex(index - 1)}>{t('files.previousDrawing')}</Button>
      <Button variant="plain" disabled={index === views.length - 1} onClick={() => onIndex(index + 1)}>{t('files.nextDrawing')}</Button>
    </div>
  );
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={view.file.name} wide footer={footer || undefined}>
      {body}
    </Sheet>
  );
}
