import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileView } from '../../../api/contract/views';
import { useFileLink, usePictureTest } from '../../../app/files';
import { PRIVATE } from '../../../app/privateMark';
import { useCall } from '../../../app/runtime';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { PreviewSheet } from '../../project/files/PreviewSheet';

const SHOWN = 6;

function Drawing({ view, onOpen }: { view: FileView; onOpen: () => void }) {
  const isPicture = usePictureTest();
  const image = isPicture(view.latest.mimeType);
  const thumb = useFileLink(image ? view.file.id : null, view.latest.letter, 'thumb');
  return (
    <li className="w-44 shrink-0">
      <button type="button" onClick={onOpen} className="pressable flex w-full flex-col gap-2 rounded-2xl text-start">
        <span className="grid h-28 w-full place-items-center overflow-hidden rounded-2xl bg-fill text-ink-2">
          {thumb.url ? <img src={thumb.url} alt="" onError={thumb.onError} loading="lazy" decoding="async" className={`${PRIVATE} size-full object-cover`} /> : <AnimatedIcon icon={FileTextIcon} size={32} aria-hidden />}
        </span>
        <bdi className="block truncate text-[15px] text-ink">{view.file.name}</bdi>
      </button>
    </li>
  );
}

/** The 6 newest images and PDFs of a project, across the bottom of the meeting screen. A press opens the preview over the meeting. */
export function DrawingsStrip({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const files = useCall('files.list', { projectId });
  const [open, setOpen] = useState<number | null>(null);
  const drawings = (files.data ?? [])
    .filter((view) => view.latest.mimeType.startsWith('image/') || view.latest.mimeType === 'application/pdf')
    .sort((a, b) => b.latest.uploadedAt.localeCompare(a.latest.uploadedAt))
    .slice(0, SHOWN);
  if (drawings.length === 0) return null;
  return (
    <section aria-label={t('dashboard.meeting.drawings')} className="panel flex flex-col gap-3 p-5">
      <h3 className="text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-2">{t('dashboard.meeting.drawings')}</h3>
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {drawings.map((view, index) => <Drawing key={view.file.id} view={view} onOpen={() => setOpen(index)} />)}
      </ul>
      {open !== null && drawings[open] && <PreviewSheet views={drawings} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}
