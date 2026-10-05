import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { formatDay } from '../lib/dates';
import { DateField } from './DateField';

// The owner (2026-10-05): an empty date in a form showed the bulky native "dd/mm/yyyy". The forms that save with their own button
// now show the same quiet "Set date…" as the dates that save themselves, and give each change to the form at once.

beforeEach(() => {
  initI18n('en');
});

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

/** A form that holds the date, as the real forms do. */
function Holder({ start = '', onChange = () => undefined, ...rest }: { start?: string; onChange?: (value: string) => void } & Partial<Parameters<typeof DateField>[0]>) {
  const [value, setValue] = useState(start);
  return (
    <DateField
      id="start"
      label="Start date"
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('DateField: a date in a form that saves with its own button', () => {
  it('shows "Set date…" in the quiet grey for an empty date, not the full date field', () => {
    render(<Holder />);
    expect(screen.getByText('Set date…')).toHaveClass('text-ink-2');
    const field = screen.getByLabelText('Start date');
    expect(field).toHaveAttribute('type', 'date');
    expect(field).toHaveValue('');
    expect(field).not.toHaveClass('field');
    expect(field).toHaveClass('opacity-0');
    expect(screen.queryByRole('button', { name: 'Clear Start date' })).toBeNull();
  });

  it('shows a set date as the short date, with the year only for another year', () => {
    const { unmount } = render(<Holder start="2026-10-12" />);
    expect(screen.getByText(formatDay('2026-10-12', 'en'))).toBeInTheDocument();
    expect(screen.queryByText('Set date…')).toBeNull();
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-10-12');
    unmount();
    render(<Holder start="2027-02-03" />);
    expect(screen.getByText(formatDay('2027-02-03', 'en', 'shortYear'))).toBeInTheDocument();
  });

  it('opens the date picker of the browser on a press, and gives the picked date to the form at once', async () => {
    const showPicker = withPicker();
    const onChange = vi.fn();
    render(<Holder onChange={onChange} />);
    const field = screen.getByLabelText('Start date');
    await userEvent.click(field);
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(field).not.toHaveClass('field');
    fireEvent.change(field, { target: { value: '2026-10-12' } });
    expect(onChange).toHaveBeenCalledWith('2026-10-12');
    expect(screen.getByText(formatDay('2026-10-12', 'en'))).toBeInTheDocument();
  });

  it('shows the full date field to type in when the browser has no picker', async () => {
    render(<Holder />);
    const field = screen.getByLabelText('Start date');
    await userEvent.click(field);
    expect(field).toHaveClass('field');
    expect(screen.queryByText('Set date…')).toBeNull();
  });

  it('shows the full field when the keyboard comes to it, takes a typed date, and turns quiet again when the person leaves', () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<Holder onChange={onChange} onBlur={onBlur} />);
    const field = screen.getByLabelText('Start date');
    act(() => field.focus());
    expect(field).toHaveClass('field');
    fireEvent.change(field, { target: { value: '2026-10-12' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-10-12');
    fireEvent.blur(field);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(field).not.toHaveClass('field');
    expect(screen.getByText(formatDay('2026-10-12', 'en'))).toBeInTheDocument();
  });

  it('takes a date typed through the field', async () => {
    const onChange = vi.fn();
    render(<Holder onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Start date'), '2026-10-08');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-08');
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-10-08');
  });

  it('has a small control that clears a date that is not required', async () => {
    const onChange = vi.fn();
    render(<Holder start="2026-10-12" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear Start date' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByText('Set date…')).toBeInTheDocument();
    expect(screen.getByLabelText('Start date')).toHaveValue('');
  });

  it('marks a required date like the other fields, and gives it no clear control', () => {
    render(<Holder start="2026-10-12" required hint="The first working day." />);
    const field = screen.getByLabelText('Start date');
    const mark = screen.getByText('*');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark.previousElementSibling).toBe(document.querySelector('label[for="start"]'));
    expect(field).toHaveAccessibleDescription('required The first working day.');
    expect(field).not.toHaveAttribute('required');
    expect(screen.queryByRole('button', { name: 'Clear Start date' })).toBeNull();
  });

  it('can leave out the clear control for a date the form always needs', () => {
    render(<Holder start="2026-10-12" clearable={false} />);
    expect(screen.queryByRole('button', { name: 'Clear Start date' })).toBeNull();
  });

  it('shows an error below the field, marks the field, and gives the quiet look a red edge', () => {
    render(<Holder error="The end date must be after the start date." />);
    const field = screen.getByLabelText('Start date');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('The end date must be after the start date.');
    expect(screen.getByText('Set date…').parentElement).toHaveClass('border-late');
  });

  it('takes a mark and a description from a message elsewhere on the form', () => {
    render(
      <>
        <Holder hint="The plan follows it." aria-invalid aria-describedby="start-hint plan-line" />
        <p id="plan-line">The locked tasks need more days.</p>
      </>,
    );
    const field = screen.getByLabelText('Start date');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('The plan follows it. The locked tasks need more days.');
  });

  it('gives the first and last day to the date picker', () => {
    render(<Holder min="2026-10-06" max="2026-12-31" />);
    expect(screen.getByLabelText('Start date')).toHaveAttribute('min', '2026-10-06');
    expect(screen.getByLabelText('Start date')).toHaveAttribute('max', '2026-12-31');
  });

  it('opens no picker and offers no clear control when it is off', async () => {
    const showPicker = withPicker();
    render(<Holder start="2026-10-12" disabled />);
    expect(screen.getByLabelText('Start date')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Clear Start date' })).toBeNull();
    expect(showPicker).not.toHaveBeenCalled();
  });

  it('says "Set date…" and the clear word in Arabic on an Arabic screen', () => {
    initI18n('ar');
    render(<Holder label="تاريخ البدء" />);
    expect(screen.getByText('اختر التاريخ…')).toBeInTheDocument();
    initI18n('en');
  });
});
