import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { formatDay } from '../lib/dates';
import { DateDraftField } from './DateDraftField';

beforeEach(() => {
  initI18n('en');
});

describe('DateDraftField', () => {
  it('sends a date once for Enter and the blur after it, and again when the person comes back after a refusal (review 2026-10-03)', async () => {
    const onCommit = vi.fn();
    render(<><DateDraftField id="due" label="Due" value="2026-10-01" onCommit={onCommit} /><button type="button">Away</button></>);
    const field = screen.getByLabelText('Due');
    // The keyboard comes to the field, so the person types the date (owner, 2026-10-05, item 8).
    act(() => field.focus());
    fireEvent.change(field, { target: { value: '2026-10-12' } });
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByText('Away'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    // The server refused, so the value stays 2026-10-01. The person comes back and presses Enter on the same date.
    act(() => field.focus());
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith('2026-10-12');
  });
});

// The owner (2026-10-05, item 8): an empty date showed the native "dd/mm/yyyy". It now shows "Set date…" in a quiet button, and a
// press opens the date picker. A set date shows the short date and a small clear control.
describe('DateDraftField as a quiet button (owner, 2026-10-05, item 8)', () => {
  const realPicker = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'showPicker');
  afterEach(() => {
    if (realPicker) Object.defineProperty(HTMLInputElement.prototype, 'showPicker', realPicker);
    else delete (HTMLInputElement.prototype as { showPicker?: unknown }).showPicker;
  });
  const withPicker = () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { value: showPicker, configurable: true, writable: true });
    return showPicker;
  };

  it('shows "Set date…" in the quiet grey for an empty date, not the full date field', () => {
    render(<DateDraftField id="start" label="Start of Concept" value="" onCommit={() => undefined} />);
    const set = screen.getByText('Set date…');
    expect(set).toHaveClass('text-ink-2');
    const field = screen.getByLabelText('Start of Concept');
    expect(field).toHaveAttribute('type', 'date');
    expect(field).not.toHaveClass('field');
    expect(field).toHaveClass('opacity-0');
  });

  it('opens the date picker of the browser on a press, and saves the picked date at once', async () => {
    const showPicker = withPicker();
    const onCommit = vi.fn();
    render(<DateDraftField id="start" label="Start of Concept" value="" onCommit={onCommit} />);
    const field = screen.getByLabelText('Start of Concept');
    await userEvent.click(field);
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(field).not.toHaveClass('field');
    // The picker reports its choice with a change event.
    fireEvent.change(field, { target: { value: '2026-10-12' } });
    expect(onCommit).toHaveBeenCalledWith('2026-10-12');
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('shows the date field to type in when the browser has no picker', async () => {
    const onCommit = vi.fn();
    render(<DateDraftField id="start" label="Start of Concept" value="" onCommit={onCommit} />);
    const field = screen.getByLabelText('Start of Concept');
    await userEvent.click(field);
    expect(field).toHaveClass('field');
    expect(screen.queryByText('Set date…')).toBeNull();
  });

  it('shows the date field when the keyboard comes to it, saves only when the person leaves, and turns quiet again', () => {
    const onCommit = vi.fn();
    render(<DateDraftField id="start" label="Start of Concept" value="" onCommit={onCommit} />);
    const field = screen.getByLabelText('Start of Concept');
    act(() => field.focus());
    expect(field).toHaveClass('field');
    fireEvent.change(field, { target: { value: '0002-10-12' } });
    fireEvent.change(field, { target: { value: '2026-10-12' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2026-10-12');
    expect(field).not.toHaveClass('field');
  });

  it('shows a set date as a short date, with a small control that clears it', async () => {
    const onCommit = vi.fn();
    render(<DateDraftField id="start" label="Start of Concept" value="2026-10-12" onCommit={onCommit} />);
    expect(screen.getByText(formatDay('2026-10-12', 'en'))).toBeInTheDocument();
    expect(screen.queryByText('Set date…')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear Start of Concept' }));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('adds the year to a date of another year', () => {
    render(<DateDraftField id="end" label="End of Concept" value="2027-02-03" onCommit={() => undefined} />);
    expect(screen.getByText(formatDay('2027-02-03', 'en', 'shortYear'))).toBeInTheDocument();
  });
});

// fbk_009 (Faisal, 2026-10-18): on a computer, a press opens Madar's calendar, and a picked day saves once.
describe('DateDraftField on a computer: Madar\'s calendar (fbk_009)', () => {
  let matchMediaSpy: ReturnType<typeof vi.spyOn> | undefined;
  const pointer = (fine: boolean) => {
    matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: fine && query === '(pointer: fine)', media: query }) as MediaQueryList,
    );
  };
  afterEach(() => {
    matchMediaSpy?.mockRestore();
    matchMediaSpy = undefined;
  });

  it('a press opens the calendar, and a picked day saves at once, and the blur after it does not save again', async () => {
    pointer(true);
    const onCommit = vi.fn();
    render(<><DateDraftField id="start" label="Start of Concept" value="2026-10-12" onCommit={onCommit} /><button type="button">Away</button></>);
    await userEvent.click(screen.getByLabelText('Start of Concept'));
    expect(screen.getByRole('dialog', { name: 'Pick a date' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: formatDay('2026-10-15', 'en', 'long') }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2026-10-15');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByText('Away'));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('with a coarse pointer (a phone), a press calls the browser picker as before', async () => {
    pointer(false);
    const showPicker = vi.fn();
    const realPicker = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'showPicker');
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { value: showPicker, configurable: true, writable: true });
    try {
      render(<DateDraftField id="start" label="Start of Concept" value="2026-10-12" onCommit={() => undefined} />);
      await userEvent.click(screen.getByLabelText('Start of Concept'));
      expect(showPicker).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      if (realPicker) Object.defineProperty(HTMLInputElement.prototype, 'showPicker', realPicker);
      else delete (HTMLInputElement.prototype as { showPicker?: unknown }).showPicker;
    }
  });
});

// chats-19 (UX audit 2026-10-19): a stage end cannot come before its start, so the calendar greys those days out.
describe('DateDraftField with a range', () => {
  it('greys out the days outside min and max in the calendar, and gives the range to the date field', async () => {
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query === '(pointer: fine)', media: query }) as MediaQueryList,
    );
    render(<DateDraftField id="end" label="End of Concept" value="2026-10-20" min="2026-10-16" max="2026-10-25" onCommit={() => undefined} />);
    expect(screen.getByLabelText('End of Concept')).toHaveAttribute('min', '2026-10-16');
    expect(screen.getByLabelText('End of Concept')).toHaveAttribute('max', '2026-10-25');
    await userEvent.click(screen.getByLabelText('End of Concept'));
    expect(screen.getByRole('button', { name: formatDay('2026-10-15', 'en', 'long') })).toBeDisabled();
    expect(screen.getByRole('button', { name: formatDay('2026-10-16', 'en', 'long') })).toBeEnabled();
    expect(screen.getByRole('button', { name: formatDay('2026-10-26', 'en', 'long') })).toBeDisabled();
    spy.mockRestore();
  });
});

