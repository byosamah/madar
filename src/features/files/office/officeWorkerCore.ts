import { docxToRawHtml, type DocxRaw } from './docxConvert';
import type { OfficeKind } from './officeKind';
import { xlsxToSheets, type SheetsResult } from './xlsxSheets';

/**
 * What the worker does for one message (tsk_495). It sits apart from `officeWorker.ts`, so a test runs the same code without a worker.
 * A Word file gives HTML that is not clean yet (the page cleans it), an Excel file gives the tables.
 */
export type WorkerRequest = { kind: OfficeKind; bytes: ArrayBuffer };
export type WorkerReply = DocxRaw | SheetsResult;

export async function handleOffice(request: WorkerRequest): Promise<WorkerReply> {
  return request.kind === 'docx' ? docxToRawHtml(request.bytes) : xlsxToSheets(request.bytes);
}
