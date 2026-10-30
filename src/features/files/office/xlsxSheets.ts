import { zipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/universal';
import { SHEET_LIMITS } from './officeKind';
import { unpackZip } from './zipGuard';

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

/** The parts that the reader needs, the same as its own filter: XML files and their relationship files. */
const isXml = (name: string) => name.endsWith('.xml') || name.endsWith('.xml.rels');

/**
 * The start of a `dimension`, `row` or `c` element, with or without a namespace prefix. The look-ahead keeps `col`, `cfRule` and `c:chart`
 * out. The attributes are then read one by one from the tag start (`attributesOf`), so the text of one attribute value can never pass for
 * another attribute (second and third automatic reviews, 2026-10-30).
 */
const START = /<(?:[^\s/>:]+:)?(dimension|row|c)(?=[\s/>])/g;
const ATTRIBUTE = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const TAG_END = /\s*\/?>/y;
const CELL = /^([A-Za-z]{1,3})(\d{1,7})$/;
const ROW = /^\d{1,7}$/;

/**
 * Every attribute of the tag that starts at `from`, by its name without a prefix (the reader strips it, so `x:r` is `r`), or null when the
 * tag does not read cleanly to its `>` or names one attribute twice (fourth automatic review, 2026-10-30).
 */
function attributesOf(xml: string, from: number): Map<string, string> | null {
  const found = new Map<string, string>();
  let at = from;
  for (;;) {
    TAG_END.lastIndex = at;
    if (TAG_END.test(xml)) return found;
    ATTRIBUTE.lastIndex = at;
    const match = ATTRIBUTE.exec(xml);
    if (!match) return null;
    const name = match[1].startsWith('xmlns:') ? match[1] : match[1].slice(match[1].indexOf(':') + 1);
    if (found.has(name)) return null;
    found.set(name, match[2] ?? match[3]);
    at = ATTRIBUTE.lastIndex;
  }
}

/** The number of a column name: A is 1, Z is 26, AA is 27, XFD is 16,384. More than four letters gives a number above any real column. */
function columnNumber(letters: string): number {
  if (letters.length > 4) return Number.MAX_SAFE_INTEGER;
  let n = 0;
  for (const letter of letters) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n;
}

/**
 * The size of the dense grid that the reader would build for one sheet: the rows times the columns, taken from the declared dimension and
 * from every cell reference (`<c r="XFD1048576">`). A cheap scan of the XML text, so a sheet that names a far cell is refused before the
 * full parse (read-excel-file builds a grid up to the farthest cell). A reference that the scan cannot read (an entity such as `&#88;`, a
 * number in another form) counts as too big, so the file is refused and never reaches the reader.
 */
export function gridOf(xml: string): number {
  let rows = 0;
  let columns = 0;
  for (const start of xml.matchAll(START)) {
    const element = start[1];
    const attributes = attributesOf(xml, start.index + start[0].length);
    if (!attributes) return Number.POSITIVE_INFINITY;
    // A cell or a row with no reference takes the next place, so it cannot reach far.
    const value = attributes.get(element === 'dimension' ? 'ref' : 'r');
    if (value === undefined) continue;
    if (element === 'row') {
      if (!ROW.test(value)) return Number.POSITIVE_INFINITY;
      rows = Math.max(rows, Number(value));
      continue;
    }
    const cell = CELL.exec(element === 'dimension' ? value.split(':').pop() ?? '' : value);
    if (!cell) return Number.POSITIVE_INFINITY;
    columns = Math.max(columns, columnNumber(cell[1].toUpperCase()));
    rows = Math.max(rows, Number(cell[2]));
  }
  return rows * columns;
}

/**
 * The XML parts as a ZIP file with the STORE method. fflate unzips a large deflated archive in blob workers, and the CSP of the page
 * (`worker-src 'self'`) refuses a blob worker. A stored copy needs no inflate, so the reader never starts a worker.
 */
export function storedZip(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 0 });
}

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
  // The unpack counts the real output, so a zip bomb stops at the limit (zipGuard.ts). Only the XML parts are kept.
  const unpacked = unpackZip(bytes, { want: isXml });
  if (unpacked.kind !== 'ok') return { kind: unpacked.kind };
  // The size of the grid, before the full parse: a far cell must not build a dense grid.
  const decoder = new TextDecoder();
  let grid = 0;
  // Every XML part, not only xl/worksheets: the reader finds a sheet through the workbook links, which can name any path.
  for (const data of Object.values(unpacked.entries)) {
    grid += gridOf(decoder.decode(data));
    if (grid > SHEET_LIMITS.cells) return { kind: 'cells' };
  }
  let parsed: { sheet: string; data: Cell[][] }[];
  try {
    parsed = (await readXlsxFile(new Blob([storedZip(unpacked.entries) as BlobPart]))) as { sheet: string; data: Cell[][] }[];
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
