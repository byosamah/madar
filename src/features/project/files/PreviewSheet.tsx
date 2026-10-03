import { useTranslation } from 'react-i18next';
import type { FileView } from '../../../api/contract/views';
import { useFileUrl } from '../../../app/files';
import { Button } from '../../../components/Button';
import { Sheet } from '../../../components/Sheet';

/** True for a file the preview can show: a picture or a PDF. */
export const canPreview = (mimeType: string) => mimeType.startsWith('image/') || mimeType === 'application/pdf';

/** A file preview: an image or a PDF. With more than one view, Previous and Next move through them. */
export function PreviewSheet({ views, index, onIndex, onClose }: { views: FileView[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const view = views[index];
  const url = useFileUrl(view.file.id, view.latest.letter);
  const type = view.latest.mimeType;
  let body = <p className="text-subheadline text-label-2">{t('files.noPreview')}</p>;
  if (url && type.startsWith('image/')) body = <img src={url} alt={view.file.name} className="w-full rounded-2xl bg-white" />;
  else if (url && type === 'application/pdf') body = <iframe src={url} title={view.file.name} className="h-[70dvh] w-full rounded-2xl bg-white" />;
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
