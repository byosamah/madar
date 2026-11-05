import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PRIVATE } from '../../../app/privateMark';
import { Tabs } from '../../../components/Tabs';
import { SHEET_LIMITS } from './officeKind';
import type { SheetTable } from './xlsxSheets';

/**
 * The sheets of an Excel file as tables (tsk_495): one tab for each sheet, and no tabs for a file with one sheet. Every cell is React
 * text, so a cell can never carry a tag or a link. The table scrolls inside its box, on both axes, so a wide sheet never widens the
 * sheet of the preview. A sheet that was cut says so in one quiet line. With `fill` (the big center window on a desk, fbk_079) the box takes
 * the free height of the body, with no fixed maximum, and scrolls inside.
 */
export function OfficeSheets({ sheets, moreSheets, fill = false }: { sheets: SheetTable[]; moreSheets: boolean; fill?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState('0');
  const sheet = sheets[Number(open)] ?? sheets[0];
  return (
    <div className={`flex flex-col gap-3 ${fill ? 'min-h-0 flex-1' : ''}`}>
      {sheets.length > 1 && (
        <Tabs
          label={t('officePreview.sheets')}
          value={open}
          options={sheets.map((entry, i) => ({ value: String(i), label: entry.name }))}
          onChange={setOpen}
          idPrefix="sheet"
        />
      )}
      <div id="sheet-panel" role={sheets.length > 1 ? 'tabpanel' : undefined} aria-labelledby={sheets.length > 1 ? `sheet-${open}` : undefined} className={`${PRIVATE} overflow-auto rounded-2xl bg-card shadow-card ${fill ? 'min-h-0 flex-1' : 'max-h-[62dvh] sm:max-h-[60dvh]'}`}>
        {sheet.rows.length === 0 ? (
          <p className="p-4 text-subheadline text-label-2">{t('officePreview.emptySheet')}</p>
        ) : (
          <table className="min-w-full border-collapse text-footnote">
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className={`min-w-[6rem] max-w-[22rem] border-b border-e border-hairline px-3 py-1.5 text-start align-top ${r === 0 ? 'font-semibold' : ''}`}>
                      {/* The direction sits on the text, not on the cell: the cell keeps the side of the page, the text reads in its own direction. */}
                      <bdi>{cell}</bdi>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {(sheet.moreRows || sheet.moreColumns) && (
        <p className="text-footnote text-label-2">{t('officePreview.cut', { rows: SHEET_LIMITS.rows, columns: SHEET_LIMITS.columns })}</p>
      )}
      {moreSheets && <p className="text-footnote text-label-2">{t('officePreview.moreSheets', { count: SHEET_LIMITS.sheets })}</p>}
    </div>
  );
}
