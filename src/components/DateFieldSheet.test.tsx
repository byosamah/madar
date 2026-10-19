import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { formatDay, formatMonthYear } from '../lib/dates';
import { DateDraftField } from './DateDraftField';
import { DateField } from './DateField';
import { Sheet } from './Sheet';

// chats-02 (UX audit 2026-10-19): in a modal sheet the focus trap pulled the focus out of Madar's calendar back into the date
// field. The field then showed the browser box, and a second press opened no calendar. The calendar now draws inside the sheet.

beforeEach(() => {
  initI18n('en');
});

let matchMediaSpy: ReturnType<typeof vi.spyOn> | undefined;
beforeEach(() => {
  matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: query === '(pointer: fine)', media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList,
  );
});
afterEach(() => {
  matchMediaSpy?.mockRestore();
});

function FormInSheet({ draft = false }: { draft?: boolean }) {
  const [value, setValue] = useState('2026-10-12');
  return (
    <Sheet open onOpenChange={() => undefined} title="New thing">
      <input aria-label="Title" />
      {draft
        ? <DateDraftField id="when" label="When" value={value} onCommit={(next) => setValue(next ?? '')} />
        : <DateField id="when" label="When" value={value} onChange={setValue} />}
    </Sheet>
  );
}

describe('a date field inside a modal sheet', () => {
  it.each([false, true])('opens the calendar inside the sheet, keeps the focus in it, and opens again after a pick (draft %s)', async (draft) => {
    render(<FormInSheet draft={draft} />);
    const field = screen.getByLabelText('When');
    await userEvent.click(field);
    const calendar = screen.getByRole('dialog', { name: 'Pick a date' });
    // The calendar sits inside the sheet, so the focus trap of the sheet lets the focus move into the day grid.
    expect(calendar.parentElement?.closest('[role="dialog"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: formatDay('2026-10-12', 'en', 'long') })).toHaveFocus();
    // The quiet look stays: the field never turns into the browser box.
    expect(field).not.toHaveClass('field');
    // The keys work in the calendar.
    await userEvent.keyboard('{PageDown}');
    expect(screen.getByText(formatMonthYear('2026-11-01', 'en'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: formatDay('2026-11-14', 'en', 'long') }));
    expect(screen.queryByRole('dialog', { name: 'Pick a date' })).toBeNull();
    expect(field).not.toHaveClass('field');
    // A second press opens the calendar again.
    await userEvent.click(field);
    expect(screen.getByRole('dialog', { name: 'Pick a date' })).toBeInTheDocument();
    expect(field).not.toHaveClass('field');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Pick a date' })).toBeNull();
    // Escape closed the calendar only, not the sheet.
    expect(screen.getByRole('dialog', { name: 'New thing' })).toBeInTheDocument();
    await userEvent.click(field);
    expect(screen.getByRole('dialog', { name: 'Pick a date' })).toBeInTheDocument();
  });
});
