import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { TrackerExportRow } from '../api/contract/views';
import { exportTable } from './trackerExport';

const t = ((key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key)) as unknown as TFunction;

const ROW: TrackerExportRow = {
  date: '2026-09-30', time: '09:00:05', event: 'logged', waiting: null, by: 'Sara Team', byAr: 'سارة', byAgent: false, type: 'message',
  direction: 'in', title: 'Can the lobby move?', note: '', files: [], auto: null,
};

/** The person of each line in the language of the screen (owner item 12, 2026-10-05). */
describe('the Tracker export with two names', () => {
  it('writes the Arabic name on an Arabic screen and the English name on an English one', () => {
    expect(exportTable([ROW], t, 'ar')[1][3]).toBe('سارة');
    expect(exportTable([ROW], t, 'en')[1][3]).toBe('Sara Team');
    expect(exportTable([{ ...ROW, byAgent: true }], t, 'ar')[1][3]).toBe('tracker.export.agentFor:سارة');
    expect(exportTable([{ ...ROW, byAr: undefined }], t, 'ar')[1][3]).toBe('Sara Team');
  });
});
