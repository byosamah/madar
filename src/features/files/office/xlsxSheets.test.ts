import { describe, expect, it } from 'vitest';
import { sampleXlsx } from './officeFixtures';
import { SHEET_LIMITS } from './officeKind';
import { xlsxToSheets } from './xlsxSheets';

describe('xlsxToSheets (tsk_495)', () => {
  it('reads each sheet by its name, with text and numbers as text', async () => {
    const out = await xlsxToSheets(await sampleXlsx([
      { name: 'Quantities', rows: [['Item', 'Count', 'Price'], ['Columns', 12, 0.1 + 0.2], ['Beams', null, 7]] },
      { name: 'ورقة 2', rows: [['مرحبا']] },
    ]));
    if (out.kind !== 'sheets') throw new Error(`Expected sheets, got ${out.kind}.`);
    expect(out.sheets.map((sheet) => sheet.name)).toEqual(['Quantities', 'ورقة 2']);
    expect(out.sheets[0].rows).toEqual([['Item', 'Count', 'Price'], ['Columns', '12', '0.3'], ['Beams', '', '7']]);
    expect(out.sheets[1].rows).toEqual([['مرحبا']]);
    expect(out.sheets[0].moreRows).toBe(false);
    expect(out.sheets[0].moreColumns).toBe(false);
  });

  it('shows at most 1,000 rows and 50 columns of a sheet, and says that the rest was cut', async () => {
    const wide = Array.from({ length: 60 }, (_, c) => `C${c}`);
    const rows = [wide, ...Array.from({ length: 1200 }, (_, r) => wide.map((_, c) => r * 100 + c))];
    const out = await xlsxToSheets(await sampleXlsx([{ name: 'Big', rows }]));
    if (out.kind !== 'sheets') throw new Error(`Expected sheets, got ${out.kind}.`);
    const sheet = out.sheets[0];
    expect(sheet.rows).toHaveLength(SHEET_LIMITS.rows);
    expect(sheet.rows[0]).toHaveLength(SHEET_LIMITS.columns);
    expect(sheet.moreRows).toBe(true);
    expect(sheet.moreColumns).toBe(true);
    expect(SHEET_LIMITS.rows).toBe(1000);
    expect(SHEET_LIMITS.columns).toBe(50);
  });

  it('drops the empty rows at the end and the empty columns at the right', async () => {
    const out = await xlsxToSheets(await sampleXlsx([{ name: 'A', rows: [['x', null, null], [null, null, null], ['y', 'z', null], [null, null, null]] }]));
    if (out.kind !== 'sheets') throw new Error('Expected sheets.');
    expect(out.sheets[0].rows).toEqual([['x', ''], ['', ''], ['y', 'z']]);
  });

  it('refuses a sheet set that has too many cells, before it draws any of them', async () => {
    const rows = Array.from({ length: 3000 }, (_, r) => Array.from({ length: 200 }, (_, c) => r + c));
    expect((await xlsxToSheets(await sampleXlsx([{ name: 'Huge', rows }]))).kind).toBe('cells');
  }, 30_000);

  it('says "bad" for bytes that are no Excel file, and "big" for a file that unpacks too large', async () => {
    expect((await xlsxToSheets(new TextEncoder().encode('a,b,c').buffer as ArrayBuffer)).kind).toBe('bad');
    const big = await sampleXlsx([{ name: 'A', rows: [['x']] }]);
    const view = new DataView(big);
    for (let i = 0; i < big.byteLength - 4; i += 1) if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0xffffffff, true);
    expect((await xlsxToSheets(big)).kind).toBe('big');
  });

  it('says "empty" for a workbook whose sheets hold no cell', async () => {
    expect((await xlsxToSheets(await sampleXlsx([{ name: 'A', rows: [] }]))).kind).toBe('empty');
  });
});
