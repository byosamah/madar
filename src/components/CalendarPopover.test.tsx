import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { initI18n } from '../i18n';
import { formatDay, formatMonthYear, setNow } from '../lib/dates';
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

  it('shows the next month and its grid after one wheel step down, and keeps the page from scrolling', () => {
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
