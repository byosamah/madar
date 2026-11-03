import { describe, expect, it } from 'vitest';
import { FileRec, MAX_ATTACHMENTS, MESSAGE_MAX } from '../../api/contract/entities';
import { insertParts } from './insertParts';
import { isFileNamesBody } from './PictureAttachments';

/**
 * The words of an inserted message are the joined file names (fbk_070). The bubble hides them only when they equal the joined names
 * exactly (isFileNamesBody), so a cut at MESSAGE_MAX would show a broken list. The review of 2026-11-03 asked about long names: 10 names of
 * the longest length that a file may have still fit in one message, so no cut happens. This test keeps that true if a limit changes.
 */
const NAME_MAX = FileRec.shape.name.maxLength ?? 0;

describe('the parts of an insert', () => {
  it('keeps the full names of 10 files with the longest names, so the bubble still hides them', () => {
    expect(NAME_MAX).toBeGreaterThan(0);
    const picked = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => ({ id: `fil_${i}`, name: `${i} `.padEnd(NAME_MAX, 'x') }));
    const [part] = insertParts(picked);
    const joined = picked.map((file) => file.name).join(', ');
    expect(joined.length).toBeLessThanOrEqual(MESSAGE_MAX);
    expect(part.body).toBe(joined);
    const files = picked.map((file) => ({ id: file.id, name: file.name, mimeType: 'application/pdf' }));
    expect(isFileNamesBody(part.body, files as Parameters<typeof isFileNamesBody>[1])).toBe(true);
  });

  it('puts the reply on the first part only', () => {
    const picked = Array.from({ length: 25 }, (_, i) => ({ id: `fil_${i}`, name: `Sheet ${i}.pdf` }));
    const parts = insertParts(picked, { id: 'msg_1' });
    expect(parts.map((part) => part.fileIds.length)).toEqual([10, 10, 5]);
    expect(parts.map((part) => part.reply)).toEqual([{ id: 'msg_1' }, null, null]);
  });
});
