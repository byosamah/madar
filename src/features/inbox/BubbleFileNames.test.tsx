import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { Attachment } from '../../api/contract/views';
import { makeBubble, renderLog } from './logHarness';

const LONG = 'Madar_Infographic_v5_real-tiles_15-21_Oct_2026.pdf';
const pdf = (name: string): Attachment => ({ id: `fil_${name.length}`, name, mimeType: 'application/pdf' });
const AT = '2026-09-29T08:20:00.000+03:00';

describe('a file name in a chat bubble (fbk_040)', () => {
  it('keeps the chip inside the bubble: every box of the chip may shrink and cuts the name with an ellipsis', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_1', createdAt: AT, body: 'See the file.', files: [pdf(LONG)] })] });
    const chip = screen.getByRole('button', { name: `Preview ${LONG}` });
    const item = chip.closest('li') as HTMLElement;
    const list = item.closest('ul') as HTMLElement;
    expect(chip).toHaveClass('max-w-full');
    expect(item).toHaveClass('min-w-0', 'max-w-full');
    expect(list).toHaveClass('min-w-0', 'max-w-full');
    expect(chip.querySelector('bdi')).toHaveClass('truncate');
  });

  it('shows the name once when a message with a file has no words of its own', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_1', createdAt: AT, body: LONG, files: [pdf(LONG)] })] });
    expect(screen.getAllByText(LONG)).toHaveLength(1);
    expect(screen.getByRole('button', { name: `Preview ${LONG}` })).toBeInTheDocument();
  });

  it('shows the joined names once for two files that are not pictures', () => {
    const plan = pdf('Plan.pdf');
    const sheet: Attachment = { id: 'fil_zzz', name: 'Sheet.xlsx', mimeType: 'application/vnd.ms-excel' };
    renderLog({ bubbles: [makeBubble({ id: 'msg_1', createdAt: AT, body: 'Plan.pdf, Sheet.xlsx', files: [plan, sheet] })] });
    expect(screen.queryByText('Plan.pdf, Sheet.xlsx')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview Plan.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Sheet.xlsx' })).toBeInTheDocument();
  });

  it('keeps the words that a person typed, also when they name the file', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_1', createdAt: AT, body: `Here is ${LONG}`, files: [pdf(LONG)] })] });
    const row = screen.getByText(`Here is ${LONG}`).closest('li') as HTMLElement;
    expect(within(row).getByRole('button', { name: `Preview ${LONG}` })).toBeInTheDocument();
  });
});
