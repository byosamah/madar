import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isRemote } from '../../../app/files';
import { useRuntime, type Runtime } from '../../../app/runtime';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { OfficeDoc } from './OfficeDoc';
import { OfficeSheets } from './OfficeSheets';
import { OFFICE_MAX_BYTES, type OfficeKind } from './officeKind';
import { readOffice } from './officeRunner';
import type { SheetTable } from './xlsxSheets';

/**
 * The body of the preview for a Word or Excel file (tsk_495). It lives in its own chunk (`PreviewSheet` loads it with lazyOverlay). The
 * reading code (mammoth, read-excel-file, fflate) lives in a Web Worker of its own (`officeWorker.ts`), and DOMPurify loads in a chunk
 * of its own for a Word file. The worker has a time budget of 8 seconds; over it, the worker ends and the person sees the quiet line.
 *
 * Where the bytes come from:
 * - Real build: files.link signs a link as the person (the rights are the same as a download, also for a locked folder), and the page
 *   reads it with fetch and `credentials: 'omit'`. The store allows a GET from the page (`config/r2-cors.*.json`), as for "Download
 *   all". The CSP lists the store in `connect-src` already. A signed link is never opened in a window.
 * - Prototype: files.get gives the stored data.
 * A file above `OFFICE_MAX_BYTES` is not read: the size of the version is known first, else the store's Content-Length decides.
 */
type Line = 'tooBig' | 'tooMany' | 'failed' | 'emptyDoc' | 'emptySheet';
type Drawn =
  | { kind: 'loading' }
  | { kind: 'html'; html: string }
  | { kind: 'sheets'; sheets: SheetTable[]; moreSheets: boolean }
  | { kind: 'line'; line: Line };

const line = (value: Line): Drawn => ({ kind: 'line', line: value });

/** The bytes of a version, or 'big' when it is above the limit. */
async function readBytes(runtime: Runtime, id: string, letter: string | undefined): Promise<ArrayBuffer | 'big'> {
  if (isRemote(runtime)) {
    const link = await runtime.api.call('files.link', { id, letter, variant: 'full', disposition: 'attachment' });
    const response = await fetch(link.url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`The file store answered ${response.status}.`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > OFFICE_MAX_BYTES) {
      await response.body?.cancel();
      return 'big';
    }
    const bytes = await response.arrayBuffer();
    return bytes.byteLength > OFFICE_MAX_BYTES ? 'big' : bytes;
  }
  const { blob } = await runtime.api.call('files.get', { id, letter });
  return blob.size > OFFICE_MAX_BYTES ? 'big' : blob.arrayBuffer();
}

async function draw(runtime: Runtime, o: { id: string; letter?: string; kind: OfficeKind; size?: number }): Promise<Drawn> {
  if (o.size !== undefined && o.size > OFFICE_MAX_BYTES) return line('tooBig');
  const bytes = await readBytes(runtime, o.id, o.letter);
  if (bytes === 'big') return line('tooBig');
  // The unpack and the parse run in a worker with a time budget (officeRunner.ts). A timeout or a broken worker is "failed".
  const result = await readOffice(o.kind, bytes);
  switch (result.kind) {
    case 'html': return result;
    case 'sheets': return result;
    case 'empty': return line(o.kind === 'docx' ? 'emptyDoc' : 'emptySheet');
    case 'big': return line('tooBig');
    case 'cells': return line('tooMany');
    default: return line('failed');
  }
}

/** `fill`: the big center window on a desk (fbk_079). The page or the table takes the free height of the body and scrolls inside. */
export function OfficeBody({ fileId, letter, name, kind, size, fill = false }: { fileId: string; letter?: string; name: string; kind: OfficeKind; size?: number; fill?: boolean }) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const [drawn, setDrawn] = useState<Drawn>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    setDrawn({ kind: 'loading' });
    draw(runtime, { id: fileId, letter, kind, size }).then(
      (next) => { if (live) setDrawn(next); },
      () => { if (live) setDrawn(line('failed')); },
    );
    return () => { live = false; };
  }, [runtime, fileId, letter, kind, size]);

  if (drawn.kind === 'loading') return <p role="status" className="py-10 text-center text-subheadline text-label-2">{t('officePreview.loading')}</p>;
  if (drawn.kind === 'line') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span data-file-icon className="grid size-16 place-items-center rounded-2xl bg-fill text-label-2">
          <AnimatedIcon icon={FileTextIcon} size={32} aria-hidden />
        </span>
        <p className="text-subheadline text-label-2">{t(`officePreview.${drawn.line}`)}</p>
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-3 ${fill ? 'min-h-0 flex-1' : ''}`}>
      {drawn.kind === 'html' ? <OfficeDoc html={drawn.html} name={name} fill={fill} /> : <OfficeSheets sheets={drawn.sheets} moreSheets={drawn.moreSheets} fill={fill} />}
      <p className="text-footnote text-label-2">{t('officePreview.note')}</p>
    </div>
  );
}
