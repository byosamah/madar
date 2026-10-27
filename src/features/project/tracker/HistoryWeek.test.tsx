import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TrackerRow } from '../../../api/contract/views';
import { initI18n } from '../../../i18n';
import { History } from './History';

// A Monday line. The office week runs Sunday to Saturday, so 2026-10-25 starts its week.
const row = {
  entry: {
    id: 'trk_001', projectId: 'prj_001', type: 'message', direction: 'in', title: 'The client called about the lobby', note: '',
    date: '2026-10-26', waiting: null, closedAt: null, closedBy: null, fileIds: [], peopleIds: [], auto: null,
    createdBy: 'usr_002', createdAt: '2026-10-26T09:00:00.000Z',
  },
  createdBy: { id: 'usr_002', name: 'Faisal' },
  closedBy: null,
  people: [],
  files: [],
  replyTask: null,
  canClose: false,
  canEdit: false,
  canDelete: false,
} as unknown as TrackerRow;

const rows = [row];
const onOpen = () => {};

describe('the Tracker history', () => {
  // History is memoized and the query keeps the same rows, so the day must come in as a prop (code review 2026-10-27).
  it('names the week again when the day moves into the next week, with the same rows', () => {
    initI18n('en');
    const view = render(<History rows={rows} onOpen={onOpen} today="2026-10-27" />);
    expect(screen.getByRole('heading', { name: 'This week' })).toBeInTheDocument();
    view.rerender(<History rows={rows} onOpen={onOpen} today="2026-11-04" />);
    expect(screen.getByRole('heading', { name: 'Last week' })).toBeInTheDocument();
  });
});
