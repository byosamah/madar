import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { initI18n } from '../i18n';
import { formatDay, formatMonth, formatMonthYear, setNow } from '../lib/dates';
import { CalendarPopover } from './CalendarPopover';

beforeEach(() => {
  initI18n('en');
});

// The anchor is a real element in the page, as in the form. The popover takes its place from it.
const anchors: HTMLElement[] = [];
afterEach(() => {
  for (const anchor of anchors.splice(0)) anchor.remove();
  setNow(null);
});

function setup(props: Partial<ComponentProps<typeof CalendarPopover>> = {}) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  anchors.push(anchor);
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<CalendarPopover anchor={anchor} value="2026-10-18" onPick={onPick} onClose={onClose} {...props} />);
  return { onPick, onClose };
}

const dayButton = (day: string, lang: 'en' | 'ar' = 'en') => screen.getByRole('button', { name: formatDay(day, lang, 'long') });

describe('CalendarPopover', () => {
  it('is a dialog named "Pick a date" that shows the month and the year of the value', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Pick a date' })).toBeInTheDocument();
    expect(screen.getByText(formatMonthYear('2026-10-01', 'en'))).toBeInTheDocument();
    expect(screen.getByText('October 2026')).toBeInTheDocument();
  });

  it('puts the focus on the chosen day when it opens', () => {
    setup();
    expect(dayButton('2026-10-18')).toHaveFocus();
    expect(dayButton('2026-10-18')).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks today', () => {
    setNow(new Date('2026-10-18T09:00:00+03:00'));
    setup({ value: '2026-10-02' });
    expect(dayButton('2026-10-18')).toHaveAttribute('aria-current', 'date');
    expect(dayButton('2026-10-19')).not.toHaveAttribute('aria-current');
  });

  it('shows the next month and its grid after one wheel step down, and does not scroll the page', () => {
    setup();
    const notPrevented = fireEvent.wheel(dayButton('2026-10-18'), { deltaY: 1, deltaMode: 1 });
    expect(notPrevented).toBe(false);
    expect(screen.getByText(formatMonthYear('2026-11-01', 'en'))).toBeInTheDocument();
    expect(screen.queryByText(formatMonthYear('2026-10-01', 'en'))).toBeNull();
    expect(dayButton('2026-11-18')).toBeInTheDocument();
  });

  it('moves one month with PageDown and PageUp', async () => {
    setup();
    await userEvent.keyboard('{PageDown}');
    expect(screen.getByText(formatMonthYear('2026-11-01', 'en'))).toBeInTheDocument();
    expect(dayButton('2026-11-18')).toHaveFocus();
    await userEvent.keyboard('{PageUp}{PageUp}');
    expect(screen.getByText(formatMonthYear('2026-09-01', 'en'))).toBeInTheDocument();
  });

  it('moves one day with the arrow keys, and a week with the up and down keys', async () => {
    setup();
    await userEvent.keyboard('{ArrowRight}');
    expect(dayButton('2026-10-19')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(dayButton('2026-10-17')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(dayButton('2026-10-24')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(dayButton('2026-10-17')).toHaveFocus();
  });

  it('follows the screen side in Arabic: the left arrow gives the next day', async () => {
    initI18n('ar');
    setup();
    await userEvent.keyboard('{ArrowLeft}');
    expect(dayButton('2026-10-19', 'ar')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(dayButton('2026-10-17', 'ar')).toHaveFocus();
  });

  it('shows one letter for each weekday in Arabic, so the seven heads never touch', () => {
    initI18n('ar');
    setup();
    const heads = Array.from(screen.getByRole('dialog').querySelectorAll('div[aria-hidden] > span'));
    expect(heads).toHaveLength(7);
    for (const head of heads) expect(head.textContent).toHaveLength(1);
  });

  it('picks the focused day with Enter', async () => {
    const { onPick } = setup();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('2026-10-19');
  });

  it('picks a day with a click', async () => {
    const { onPick } = setup();
    await userEvent.click(dayButton('2026-10-20'));
    expect(onPick).toHaveBeenCalledWith('2026-10-20');
  });

  it('closes with Escape', async () => {
    const { onClose, onPick } = setup();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('disables a day before the first day, and an arrow stops at the first day', async () => {
    setup({ min: '2026-10-16' });
    expect(dayButton('2026-10-15')).toBeDisabled();
    expect(dayButton('2026-10-16')).toBeEnabled();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(dayButton('2026-10-16')).toHaveFocus();
  });

  it('disables a day after the last day', () => {
    setup({ max: '2026-10-25' });
    expect(dayButton('2026-10-26')).toBeDisabled();
    expect(dayButton('2026-10-25')).toBeEnabled();
  });
});

// chats-18 (UX audit 2026-10-19): the chosen day is easy to see, a far month is one jump away, and Today is one press.
describe('CalendarPopover: the chosen day, the month grid and Today', () => {
  it('draws the chosen day as a solid ink circle, not a light fill', () => {
    setup({ value: '2026-10-12' });
    expect(dayButton('2026-10-12')).toHaveClass('bg-ink', 'text-bg');
    expect(dayButton('2026-10-12')).not.toHaveClass('bg-fill-strong');
    expect(dayButton('2026-10-13')).not.toHaveClass('bg-ink');
  });

  it('opens a grid of 12 months on the month title, and a pick goes back to the days', async () => {
    setup({ value: '2026-10-12' });
    await userEvent.click(screen.getByRole('button', { name: 'Choose a month' }));
    expect(screen.getByText('2026')).toBeInTheDocument();
    for (let month = 1; month <= 12; month += 1) {
      expect(screen.getByRole('button', { name: formatMonth(`2026-${String(month).padStart(2, '0')}-01`, 'en') })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(screen.getByText('2027')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: formatMonth('2027-03-01', 'en') }));
    expect(screen.getByText(formatMonthYear('2027-03-01', 'en'))).toBeInTheDocument();
    // The day number stays, and the focus follows the cursor.
    expect(dayButton('2027-03-12')).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Next year' })).toBeNull();
  });

  it('greys out the months outside the range in the month grid', async () => {
    setup({ value: '2026-10-12', min: '2026-08-15', max: '2026-12-20' });
    await userEvent.click(screen.getByRole('button', { name: 'Choose a month' }));
    expect(screen.getByRole('button', { name: formatMonth('2026-07-01', 'en') })).toBeDisabled();
    expect(screen.getByRole('button', { name: formatMonth('2026-08-01', 'en') })).toBeEnabled();
    expect(screen.getByRole('button', { name: formatMonth('2026-12-01', 'en') })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous year' })).toBeDisabled();
  });

  it('moves the view to this month with the Today button', async () => {
    setNow(new Date('2026-10-18T09:00:00+03:00'));
    setup({ value: '2028-02-03' });
    expect(screen.getByText(formatMonthYear('2028-02-01', 'en'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText(formatMonthYear('2026-10-01', 'en'))).toBeInTheDocument();
    expect(dayButton('2026-10-18')).toHaveFocus();
  });

  it('Today goes back to the days from the month grid, and stops inside the range', async () => {
    setNow(new Date('2026-10-18T09:00:00+03:00'));
    setup({ value: '2026-12-03', min: '2026-11-01' });
    await userEvent.click(screen.getByRole('button', { name: 'Choose a month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.queryByRole('button', { name: 'Next year' })).toBeNull();
    // Today is before the first day, so the view stops at the first day.
    expect(screen.getByText(formatMonthYear('2026-11-01', 'en'))).toBeInTheDocument();
  });

  it('has the Arabic words for the month title, the years and Today', async () => {
    initI18n('ar');
    setup({ value: '2026-10-12' });
    expect(screen.getByRole('button', { name: 'اليوم' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'اختر الشهر' }));
    expect(screen.getByRole('button', { name: 'السنة التالية' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'السنة السابقة' })).toBeInTheDocument();
  });
});
