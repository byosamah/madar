import { crc32Update } from '../../../lib/zip';

/**
 * Small Word and Excel files for the tests and the screenshots (tsk_495). They are made from plain XML in a ZIP file, so no Office
 * program is needed. The Word file carries hostile parts on purpose: a link with a script address, a picture of an outside address, a
 * vector picture and a text that looks like a tag.
 */
type Part = { name: string; data: Uint8Array };
const utf8 = new TextEncoder();
const enc = (value: string) => utf8.encode(value);

/**
 * A ZIP file with the STORE method and real folder names. The `makeZip` of `lib/zip.ts` flattens a name (it makes a safe file name for
 * "Download all"), so it cannot make a Word or Excel file, which keep their parts in folders.
 */
export function storeZip(parts: Part[]): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = utf8.encode(part.name);
    const crc = crc32Update(0, part.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, part.data.length, true);
    local.setUint32(22, part.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, part.data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, part.data.length, true);
    entry.setUint32(24, part.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + part.data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, parts.length, true);
  end.setUint16(10, parts.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out.buffer;
}
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const run = (text: string, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const para = (inner: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
const image = (rid: string) => `<w:r><w:drawing><wp:inline><wp:extent cx="990000" cy="792000"/><wp:docPr id="1" name="Picture" descr="A plan"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/** A Word file: a heading, a bold line, a script-looking text, a table, a picture, a vector picture and two links. */
export async function sampleDocx(o: { arabic?: boolean } = {}): Promise<ArrayBuffer> {
  const body = [
    para(run(o.arabic ? 'تقرير الموقع' : 'Site report'), 'Heading1'),
    para(run(o.arabic ? 'ملاحظات الزيارة الأخيرة' : 'Notes of the last visit', true)),
    para(run('<script>alert(1)</script> and <img src=x onerror=alert(2)>')),
    para('<w:hyperlink r:id="rId1">' + run('Run this link') + '</w:hyperlink>'),
    para('<w:hyperlink r:id="rId4">' + run('Open the site') + '</w:hyperlink>'),
    `<w:tbl><w:tr><w:tc><w:p>${run('Item')}</w:p></w:tc><w:tc><w:p>${run('Count')}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run('Columns')}</w:p></w:tc><w:tc><w:p>${run('12')}</w:p></w:tc></w:tr></w:tbl>`,
    para(image('rId2')),
    para(image('rId3')),
    para(image('rId5')),
  ].join('');
  return storeZip([
    { name: '[Content_Types].xml', data: enc(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: 'word/_rels/document.xml.rels', data: enc(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/hyperlink" Target="javascript:alert(3)" TargetMode="External"/><Relationship Id="rId2" Type="${REL}/image" Target="media/plan.png"/><Relationship Id="rId3" Type="${REL}/image" Target="media/bad.svg"/><Relationship Id="rId4" Type="${REL}/hyperlink" Target="https://example.com/site" TargetMode="External"/><Relationship Id="rId5" Type="${REL}/image" Target="https://example.com/track.png" TargetMode="External"/><Relationship Id="rId6" Type="${REL}/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'word/styles.xml', data: enc(`${XML}<w:styles ${NS}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`) },
    { name: 'word/document.xml', data: enc(`${XML}<w:document ${NS}><w:body>${body}</w:body></w:document>`) },
    { name: 'word/media/plan.png', data: PNG },
    { name: 'word/media/bad.svg', data: enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(4)</script></svg>') },
  ]);
}

/** One cell of a sheet for `sampleXlsx`: text, a number, or nothing. */
export type SampleCell = string | number | null;
export type SampleSheet = { name: string; rows: SampleCell[][] };

const columnLetters = (index: number) => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/** An Excel file with the given sheets. Texts go into the shared strings, as Excel writes them. */
export async function sampleXlsx(sheets: SampleSheet[]): Promise<ArrayBuffer> {
  const strings: string[] = [];
  const idOf = (value: string) => {
    const at = strings.indexOf(value);
    if (at >= 0) return at;
    strings.push(value);
    return strings.length - 1;
  };
  const sheetXml = (sheet: SampleSheet) => {
    const rows = sheet.rows.map((cells, r) => {
      const inner = cells.map((cell, c) => {
        if (cell === null) return '';
        const ref = `${columnLetters(c)}${r + 1}`;
        return typeof cell === 'number' ? `<c r="${ref}"><v>${cell}</v></c>` : `<c r="${ref}" t="s"><v>${idOf(cell)}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${inner}</row>`;
    }).join('');
    return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  };
  const sheetFiles = sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(sheet)) }));
  return storeZip([
    { name: '[Content_Types].xml', data: enc(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc(`${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>${sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`) },
    ...sheetFiles,
    { name: 'xl/sharedStrings.xml', data: enc(`${XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join('')}</sst>`) },
  ]);
}
