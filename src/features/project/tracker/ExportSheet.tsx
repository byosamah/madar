import { useTranslation } from 'react-i18next';
import type { TrackerDirection, TrackerType } from '../../../api/contract/entities';
import { downloadText } from '../../../app/files';
import { useLang } from '../../../app/lang';
import { useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CopyIcon } from '../../../components/icons/animated/copy';
import { DownloadIcon } from '../../../components/icons/animated/download';
import { Sheet } from '../../../components/Sheet';
import { formatDay, todayISO } from '../../../lib/dates';
import { counted } from '../../../lib/grammar';
import { exportTable, toCsv, toTsv } from '../../../lib/trackerExport';

const PREVIEW_ROWS = 5;

/**
 * "Export the log": one line for every event on the Tracker, with the exact office time. The call gives the lines. This sheet turns
 * them into text in the language on screen and offers two ways out: a CSV file, and a table to paste into Excel or Google Sheets.
 */
export function ExportSheet({ projectId, code, type, side, onClose }: { projectId: string; code: string; type?: TrackerType; side?: TrackerDirection; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const rows = useCall('tracker.export', { projectId, ...(type && { type }), ...(side && { side }) }).data;
  const table = rows ? exportTable(rows, t) : null;
  const filtered = type !== undefined || side !== undefined;

  const copy = async () => {
    if (!table) return;
    try {
      await navigator.clipboard.writeText(toTsv(table));
      toast.show({ message: t('tracker.export.copied', { apps: 'Excel / Google Sheets' }) });
    } catch {
      toast.show({ tone: 'error', message: t('tracker.export.copyFailed') });
    }
  };

  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose(); }} title={t('tracker.export.title')} wide>
      <div className="flex flex-col gap-4 pt-2">
        <p className="text-subheadline text-ink-2">{t('tracker.export.intro')}</p>
        {filtered && <p className="text-footnote text-ink-2">{t('tracker.export.filtered')}</p>}
        {rows && rows.length === 0 && <p className="text-subheadline text-ink-2">{t('tracker.export.empty')}</p>}
        {rows && rows.length > 0 && (
          <section aria-label={t('tracker.export.preview')} className="flex flex-col gap-1">
            <h3 className="text-footnote font-semibold text-ink-2">{counted(t, 'tracker.export.count', rows.length)}</h3>
            <ul className="flex flex-col divide-y divide-hairline rounded-xl bg-fill px-3">
              {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                <li key={index} className="flex flex-col gap-0.5 py-2">
                  <bdi className="line-clamp-1 text-subheadline">{row.title}</bdi>
                  <span className="tabular text-footnote text-ink-2">
                    {formatDay(row.date, lang)} <bdi dir="ltr">{row.time}</bdi>{' · '}{table?.[index + 1]?.[2]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!table || rows?.length === 0}
              onClick={() => table && downloadText(`${code}-tracker-${todayISO()}.csv`, toCsv(table), 'text/csv;charset=utf-8')}
            >
              <AnimatedIcon icon={DownloadIcon} size={16} aria-hidden />
              {t('tracker.export.download', { format: 'CSV' })}
            </Button>
            <Button disabled={!table || rows?.length === 0} onClick={() => void copy()}>
              <AnimatedIcon icon={CopyIcon} size={16} aria-hidden />
              {t('tracker.export.copy')}
            </Button>
          </div>
          <p className="text-caption text-ink-2">{t('tracker.export.downloadNote')}</p>
        </div>
      </div>
    </Sheet>
  );
}
