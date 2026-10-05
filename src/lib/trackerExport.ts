import type { TFunction } from 'i18next';
import type { TrackerExportRow } from '../api/contract/views';
import type { Lang } from './dates';
import { personName } from './personName';
import { AUTO_KEY } from './tracker';

/** The columns of the export, in order. The headers come from the language on screen. */
export const EXPORT_COLUMNS = ['date', 'time', 'event', 'by', 'type', 'side', 'title', 'note', 'files', 'auto'] as const;

/** The first character of a cell that Excel or Google Sheets would run as a formula (a tab or a return can hide one too). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A cell that starts like a formula gets a single quote in front, so a spreadsheet shows it as text and never runs it. */
export function guardCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** The words of an event line. "Closed" reads "Answered" or "Received" by the loop it closed. */
function eventText(t: TFunction, row: TrackerExportRow): string {
  if (row.event === 'closed') return t(row.waiting === 'client' ? 'tracker.received' : 'tracker.answered');
  return t(`tracker.export.event.${row.event}`);
}

/** The header line and one line for each event, as plain text cells in the language of the screen (names too, owner item 12). */
export function exportTable(rows: TrackerExportRow[], t: TFunction, lang: Lang = 'en'): string[][] {
  const header = EXPORT_COLUMNS.map((column) => t(`tracker.export.col.${column}`));
  const lines = rows.map((row) => [
    row.date,
    row.time,
    eventText(t, row),
    ((name) => (row.byAgent ? t('tracker.export.agentFor', { name }) : name))(personName({ name: row.by, nameAr: row.byAr }, lang)),
    t(`tracker.type.${row.type}`),
    // The "None" side stays an empty cell: a blank reads better than a word in a sheet.
    row.direction === 'none' ? '' : t(`tracker.direction.${row.direction}`),
    row.title,
    row.note,
    row.files.join(', '),
    row.auto && AUTO_KEY[row.auto] ? t(AUTO_KEY[row.auto] as string) : '',
  ]);
  return [header, ...lines];
}

function quoted(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** The CSV text. It starts with a byte order mark, so Excel reads Arabic text as UTF-8. */
export function toCsv(table: string[][]): string {
  return `﻿${table.map((line) => line.map((cell) => quoted(guardCell(cell))).join(',')).join('\r\n')}\r\n`;
}

/** Tab-separated text for the clipboard. It pastes into Excel or Google Sheets as cells. A tab or a line break inside a cell becomes a space. */
export function toTsv(table: string[][]): string {
  return table.map((line) => line.map((cell) => guardCell(cell).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}
