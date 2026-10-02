import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { TrackerExportRow } from '../api/contract/views';
import { exportTable, guardCell, toCsv, toTsv } from './trackerExport';

// A translator that echoes the key, so the tests read the structure and not the words.
const t = ((key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key)) as unknown as TFunction;

const ROW: TrackerExportRow = {
  date: '2026-09-30', time: '09:00:05', event: 'logged', waiting: null, by: 'Sara Team', byAgent: false, type: 'message', direction: 'in',
  title: 'Can the lobby move?', note: 'A note, with "quotes"\nand a second line', files: ['Survey.pdf', 'Plan.pdf'], auto: null,
};

describe('the Tracker export text', () => {
  it('puts a single quote in front of a cell that starts like a formula', () => {
    for (const cell of ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) expect(guardCell(cell)).toBe(`'${cell}`);
    for (const cell of ['Plain', '1+1', 'a=b', '', ' =1', "'=1"]) expect(guardCell(cell)).toBe(cell);
  });

  it('builds the CSV with a byte order mark, quoted cells and the formula guard', () => {
    const csv = toCsv(exportTable([{ ...ROW, title: '=HYPERLINK("http://evil","click")', by: '@Sara' }], t));
    expect(csv.startsWith('﻿tracker.export.col.date,')).toBe(true);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('﻿' + ['date', 'time', 'event', 'by', 'type', 'side', 'title', 'note', 'files', 'auto'].map((c) => `tracker.export.col.${c}`).join(','));
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(lines[1]).toContain(`'@Sara`);
    expect(lines[1]).toContain('"A note, with ""quotes""\nand a second line"');
    expect(lines[1]).toContain('"Survey.pdf, Plan.pdf"');
    expect(lines[1].startsWith('2026-09-30,09:00:05,tracker.export.event.logged,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('keeps Arabic text as it is', () => {
    const csv = toCsv([['العنوان'], ['هل يمكن نقل المدخل؟']]);
    expect(csv).toBe('﻿العنوان\r\nهل يمكن نقل المدخل؟\r\n');
  });

  it('builds tab-separated text for the clipboard, with the guard and no tab or line break inside a cell', () => {
    const tsv = toTsv(exportTable([{ ...ROW, title: '=1+1' }], t));
    expect(tsv.startsWith('﻿')).toBe(false);
    const [, line] = tsv.split('\n');
    const cells = line.split('\t');
    expect(cells).toHaveLength(10);
    expect(cells[6]).toBe("'=1+1");
    expect(cells[7]).toBe('A note, with "quotes" and a second line');
  });

  it('words a closed event by the loop, an agent by its person, and leaves the "None" side empty', () => {
    const table = exportTable([
      { ...ROW, event: 'closed', waiting: 'us' },
      { ...ROW, event: 'closed', waiting: 'client' },
      { ...ROW, byAgent: true, direction: 'none', auto: 'reply' },
    ], t);
    expect(table[1][2]).toBe('tracker.answered');
    expect(table[2][2]).toBe('tracker.received');
    expect(table[3][3]).toBe('tracker.export.agentFor:Sara Team');
    expect(table[3][5]).toBe('');
    expect(table[3][9]).toBe('tracker.autoReply');
    expect(table[1][5]).toBe('tracker.direction.in');
  });
});
