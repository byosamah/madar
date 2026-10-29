/**
 * Which files the preview draws itself (tsk_495): a Word file (.docx) and an Excel file (.xlsx). PowerPoint, .doc and .xls stay a
 * download. This file is small on purpose: the chat chip and the Files tab import it in the first load. The drawing code that reads
 * the file (mammoth, read-excel-file, DOMPurify) loads in its own chunk, only when a person opens such a file.
 */
export type OfficeKind = 'docx' | 'xlsx';

export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A file above this size is not drawn. The preview shows a short line and the Download button (owner, 2026-10-29). */
export const OFFICE_MAX_BYTES = 15 * 1024 * 1024;

/**
 * What the screen shows of an Excel file: at most this many rows and columns of a sheet, this many sheets, and this many cells in all. It
 * sits here, and not in `xlsxSheets.ts`, so the screen part imports it without pulling the reading library into its own chunk.
 */
export const SHEET_LIMITS = { rows: 1000, columns: 50, sheets: 30, cells: 400_000 } as const;

/** The types that say nothing about the content. A browser gives one of them when it does not know the ending of a name. */
const GENERIC = new Set(['', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed']);

/**
 * The kind of file that the preview can draw, else null. The type decides. The name decides only when the type is generic, so an
 * old .doc that someone renamed to .docx keeps its clear type and stays a download.
 */
export function officeKindOf(mimeType: string | undefined, name?: string): OfficeKind | null {
  const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (type === DOCX) return 'docx';
  if (type === XLSX) return 'xlsx';
  if (!GENERIC.has(type) || !name) return null;
  const lower = name.trim().toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}
