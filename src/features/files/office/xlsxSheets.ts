import readXlsxFile from 'read-excel-file/browser';
import { SHEET_LIMITS } from './officeKind';
import { checkZip } from './zipGuard';

/**
 * An Excel file as plain tables (tsk_495). read-excel-file reads the .xlsx in the browser. The result is data, never HTML: the screen
 * draws each cell as React text, so a cell cannot carry a tag, a link or a script. Formulas show the value that Excel saved last.
 * Limits (`SHEET_LIMITS` in `officeKind.ts`): at most `SHEET_LIMITS.rows` rows and `columns` columns of a sheet, `sheets` sheets, and `cells` cells in all.
 */
export type SheetTable = {
  name: string;
  rows: string[][];
  /** True when the sheet has more rows than the screen shows. */
  moreRows: boolean;
  /** True when the sheet has more columns than the screen shows. */
  moreColumns: boolean;
};

export type SheetsResult =
  | { kind: 'sheets'; sheets: SheetTable[]; moreSheets: boolean }
  | { kind: 'empty' }
  | { kind: 'bad' }
  | { kind: 'big' }
  | { kind: 'cells' };

type Cell = string | number | boolean | Date | null | undefined;

/** A cell as the text that a person reads. A number loses the noise of the float (0.1 + 0.2), a date shows as a day. */
function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(Number(cell.toPrecision(12))) : '';
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? '' : cell.toISOString().slice(0, 10);
  return String(cell);
}

export async function xlsxToSheets(bytes: ArrayBuffer): Promise<SheetsResult> {
  const zip = checkZip(bytes);
  if (zip !== 'ok') return { kind: zip };
  let parsed: { sheet: string; data: Cell[][] }[];
  try {
    parsed = (await readXlsxFile(bytes)) as { sheet: string; data: Cell[][] }[];
  } catch {
    return { kind: 'bad' };
  }
  let cells = 0;
  for (const { data } of parsed) cells += data.length * data.reduce((widest, row) => Math.max(widest, row.length), 0);
  if (cells > SHEET_LIMITS.cells) return { kind: 'cells' };
  const sheets = parsed.slice(0, SHEET_LIMITS.sheets).map(({ sheet, data }): SheetTable => {
    let last = data.length;
    while (last > 0 && data[last - 1].every((cell) => cellText(cell) === '')) last -= 1;
    const used = data.slice(0, last);
    const width = used.reduce((widest, row) => {
      let end = row.length;
      while (end > 0 && cellText(row[end - 1]) === '') end -= 1;
      return Math.max(widest, end);
    }, 0);
    const shown = Math.min(width, SHEET_LIMITS.columns);
    const rows = used.slice(0, SHEET_LIMITS.rows).map((row) => Array.from({ length: shown }, (_, c) => cellText(row[c])));
    return { name: sheet, rows, moreRows: used.length > SHEET_LIMITS.rows, moreColumns: width > SHEET_LIMITS.columns };
  });
  if (sheets.length === 0 || sheets.every((sheet) => sheet.rows.length === 0)) return { kind: 'empty' };
  return { kind: 'sheets', sheets, moreSheets: parsed.length > SHEET_LIMITS.sheets };
}
