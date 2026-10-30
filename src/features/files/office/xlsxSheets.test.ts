import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { sampleXlsx } from './officeFixtures';
import { SHEET_LIMITS } from './officeKind';
import { gridOf, storedZip, xlsxToSheets } from './xlsxSheets';

// The second automatic review (2026-10-30): the scan must read every legal form of a reference, or refuse the file.
describe('gridOf reads every form of a cell reference (tsk_495, second review)', () => {
  const huge = (xml: string) => expect(gridOf(xml)).toBeGreaterThan(SHEET_LIMITS.cells);

  it('reads single quotes, a namespace prefix and spaces around the equals sign', () => {
    huge(`<c r='XFD1048576'/>`);
    huge(`<x:c r="XFD1048576"/>`);
    huge(`<c r = "XFD1048576"/>`);
    huge(`<x:row r='1048576'><x:c r='B1'/></x:row>`);
    huge(`<x:dimension ref='A1:XFD1048576'/>`);
  });

  it('reads the real r attribute when another attribute value holds the text r="..." (third review)', () => {
    huge(`<c t="x r='A1'" r="XFD1048576"/>`);
    huge(`<row spans='1 r="2"' r="1048576"><c r="B1"/></row>`);
    huge(`<dimension x="ref='A1:A1'" ref="A1:XFD1048576"/>`);
  });

  it('counts a tag that it cannot read to its end as too big', () => {
    huge(`<c r="A1" broken><v>1</v></c>`);
    huge(`<row r="1" s=unquoted>`);
  });

  it('counts a reference that it cannot read as too big', () => {
    huge(`<c r="&#88;FD1048576"/>`);
    huge(`<row r="1e9"/>`);
    huge(`<dimension ref="A1:&#88;FD9"/>`);
  });

  it('counts the cells only, not the col or cfRule elements, and a normal sheet keeps its size', () => {
    expect(gridOf(`<cols><col min="1" max="16384"/></cols><cfRule type="x"/><row r="2"><c r="B2"/></row>`)).toBe(4);
    expect(gridOf(`<dimension ref="A1:B2"/><row r="1"><c r="A1"/><c r="B1"/></row><row r="2"><c r="A2"/></row>`)).toBe(4);
  });
});

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

describe('xlsxToSheets reads the size of the grid before it parses (a far cell, tsk_495 review)', () => {
  const far = (ref: string, row: number) => `<row r="${row}"><c r="${ref}" t="s"><v>0</v></c></row>`;

  it('refuses a sheet whose one cell sits at XFD1048576, before the dense grid is built', async () => {
    const bytes = await sampleXlsx([{ name: 'Far', rows: [['x']], extraRows: far('XFD1048576', 1048576) }]);
    const started = Date.now();
    expect((await xlsxToSheets(bytes)).kind).toBe('cells');
    expect(Date.now() - started).toBeLessThan(2000);
  }, 20_000);

  it('refuses a sheet that declares a huge dimension, also when its cells are few', async () => {
    const bytes = await sampleXlsx([{ name: 'Wide', rows: [['x']], dimension: 'A1:XFD1048576' }]);
    expect((await xlsxToSheets(bytes)).kind).toBe('cells');
  }, 20_000);

  it('adds the grids of all sheets, so many middle-sized sheets are refused together', async () => {
    const sheet = (name: string) => ({ name, rows: [['x']], dimension: 'A1:J30000' });
    expect((await xlsxToSheets(await sampleXlsx([sheet('A'), sheet('B')]))).kind).toBe('cells');
  }, 20_000);

  it('still reads a normal sheet that declares an exact dimension', async () => {
    const out = await xlsxToSheets(await sampleXlsx([{ name: 'A', rows: [['a', 'b'], ['c', 'd']], dimension: 'A1:B2' }]));
    expect(out.kind).toBe('sheets');
  });

  it('reads a deflated file of more than 512 KB, from a STORE copy that needs no worker of its own', async () => {
    // fflate unzips a large deflated archive in blob workers. The CSP of the page (worker-src 'self') refuses a blob worker, so the preview
    // unpacks the file itself and gives the reader a copy with no deflated part.
    let seed = 7;
    const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed.toString(16).padStart(8, '0') + (seed ^ 0x5bd1e995).toString(16).padStart(8, '0'); };
    const rows = Array.from({ length: 7000 }, (_, r) => Array.from({ length: 20 }, (_, c) => (r === 0 && c === 0 ? 'first' : noise() + noise())));
    const files = unzipSync(new Uint8Array(await sampleXlsx([{ name: 'Big', rows }])));
    const packed = zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, [data, { level: 6 }] as [Uint8Array, { level: 6 }]])));
    expect(packed.byteLength).toBeGreaterThan(512 * 1024);
    const out = await xlsxToSheets(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer);
    if (out.kind !== 'sheets') throw new Error(`Expected sheets, got ${out.kind}.`);
    expect(out.sheets[0].rows[0][0]).toBe('first');
    expect(out.sheets[0].moreRows).toBe(true);
  }, 30_000);

  it('refuses a far cell in an XML part outside xl/worksheets, since the scan reads every part', async () => {
    const files = unzipSync(new Uint8Array(await sampleXlsx([{ name: 'A', rows: [['a']] }])));
    files['xl/other/sheet9.xml'] = new TextEncoder().encode(`<worksheet><sheetData>${far('XFD1048576', 1048576)}</sheetData></worksheet>`);
    const packed = zipSync(files);
    expect((await xlsxToSheets(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer)).kind).toBe('cells');
  }, 20_000);

  it('makes the copy for the reader with the STORE method only', () => {
    const copy = storedZip({ 'xl/a.xml': new TextEncoder().encode('<a>'.repeat(500)) });
    const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
    let methods: number[] = [];
    for (let i = 0; i < copy.byteLength - 4; i += 1) if (view.getUint32(i, true) === 0x02014b50) methods = [...methods, view.getUint16(i + 10, true)];
    expect(methods).toEqual([0]);
  });
});
