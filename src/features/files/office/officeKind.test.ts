import { describe, expect, it } from 'vitest';
import { DOCX, OFFICE_MAX_BYTES, XLSX, officeKindOf } from './officeKind';

describe('officeKindOf (tsk_495)', () => {
  it('knows a Word file and an Excel file by their type', () => {
    expect(officeKindOf(DOCX)).toBe('docx');
    expect(officeKindOf(XLSX)).toBe('xlsx');
    expect(officeKindOf(`${XLSX}; charset=binary`)).toBe('xlsx');
  });

  it('keeps PowerPoint, the old Word and the old Excel types as downloads', () => {
    expect(officeKindOf('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Deck.pptx')).toBeNull();
    expect(officeKindOf('application/msword', 'Old.doc')).toBeNull();
    expect(officeKindOf('application/vnd.ms-excel', 'Old.xls')).toBeNull();
    expect(officeKindOf('application/pdf', 'Plan.pdf')).toBeNull();
    // An old type with a new name is still an old file: the name never wins over a clear type.
    expect(officeKindOf('application/msword', 'Report.docx')).toBeNull();
  });

  it('falls back to the file name only when the type says nothing', () => {
    expect(officeKindOf('', 'Report.DOCX')).toBe('docx');
    expect(officeKindOf('application/octet-stream', 'Quantities.xlsx')).toBe('xlsx');
    expect(officeKindOf('application/zip', 'Quantities.xlsx')).toBe('xlsx');
    expect(officeKindOf('application/octet-stream', 'Quantities.xlsm')).toBeNull();
    expect(officeKindOf('application/octet-stream')).toBeNull();
  });

  it('sets the size limit to 15 MB', () => {
    expect(OFFICE_MAX_BYTES).toBe(15 * 1024 * 1024);
  });
});
