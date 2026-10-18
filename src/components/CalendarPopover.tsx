import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../app/lang';
import { WHEEL_START, addMonths, monthGrid, shiftMonth, wheelStep, type WheelState } from '../lib/calendar';
import { addDays, formatDay, formatMonthYear, formatNumber, formatWeekdayHead, todayISO } from '../lib/dates';
import { AnimatedIcon } from './icons/AnimatedIcon';
import { ChevronLeftIcon } from './icons/animated/chevron-left';
import { ChevronRightIcon } from './icons/animated/chevron-right';
import { Popover } from './Popover';

/** The day, or the first or last day of the range when the day is outside it. */
const keepInRange = (day: string, min?: string, max?: string): string => (min && day < min ? min : max && day > max ? max : day);
const inRange = (day: string, min?: string, max?: string): boolean => keepInRange(day, min, max) === day;

/** The chosen day when it is a full date, else today (inside the range). */
const startDay = (value: string, min?: string, max?: string): string =>
  keepInRange(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayISO(), min, max);

type CalendarPopoverProps = {
  /** The box of the date field. The calendar opens under it. */
  anchor: HTMLElement;
  /** The chosen day as YYYY-MM-DD, or '' for none. */
  value: string;
  min?: string;
  max?: string;
  onPick: (day: string) => void;
  onClose: () => void;
};

/**
 * Madar's calendar on a computer (fbk_009). It is a dialog (the WAI-ARIA date picker pattern): the month with its two buttons,
 * the week row and the 6-week grid. One day has the focus (the cursor). The arrow keys move the cursor by a day and the up and
 * down keys by a week; in Arabic the sides swap. The page keys and a wheel step move a month. Enter picks the focused day, and
 * Escape closes the calendar only, not the sheet around it. A day outside the range is disabled, and the cursor stops at the range edge.
 */
export function CalendarPopover({ anchor, value, min, max, onPick, onClose }: CalendarPopoverProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const [cursor, setCursor] = useState(() => startDay(value, min, max));
  const view = cursor.slice(0, 7);
  const today = todayISO();
  const days = monthGrid(view);
  const weekRow = days.slice(0, 7);
  const canPrevious = !min || addMonths(view, -1) >= min.slice(0, 7);
  const canNext = !max || addMonths(view, 1) <= max.slice(0, 7);

  const root = useRef<HTMLDivElement>(null);
  const cursorButton = useRef<HTMLButtonElement>(null);
  // True when a key or a wheel step moved the cursor, so the focus follows it. The first open focuses the chosen day.
  const followFocus = useRef(true);
  const wheelState = useRef<WheelState>(WHEEL_START);

  const move = (next: (day: string) => string) => {
    followFocus.current = true;
    setCursor((day) => keepInRange(next(day), min, max));
  };

  // This effect runs after the popover's own focus effect, so the chosen day wins over the first button.
  useEffect(() => {
    if (!followFocus.current) return;
    followFocus.current = false;
    cursorButton.current?.focus();
  }, [cursor]);

  // The wheel listener is not passive, so the page does not scroll under the calendar.
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const result = wheelStep(wheelState.current, {
        deltaY: event.deltaY,
        deltaMode: event.deltaMode as 0 | 1 | 2,
        timeStamp: event.timeStamp,
      });
      wheelState.current = result.state;
      if (result.steps === 0) return;
      const steps = result.steps;
      followFocus.current = true;
      setCursor((day) => keepInRange(shiftMonth(day, steps), min, max));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [min, max]);

  // A sheet that blocks the page keeps the focus in the date field. So the calendar listens at the window, before the sheet
  // does. Escape closes only the calendar.
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // In Arabic the days run from the right, so the left arrow gives the next day.
    const forward = lang === 'ar' ? -1 : 1;
    let next: (day: string) => string;
    switch (event.key) {
      case 'ArrowRight':
        next = (day) => addDays(day, forward);
        break;
      case 'ArrowLeft':
        next = (day) => addDays(day, -forward);
        break;
      case 'ArrowDown':
        next = (day) => addDays(day, 7);
        break;
      case 'ArrowUp':
        next = (day) => addDays(day, -7);
        break;
      case 'PageDown':
        next = (day) => shiftMonth(day, 1);
        break;
      case 'PageUp':
        next = (day) => shiftMonth(day, -1);
        break;
      default:
        return;
    }
    event.preventDefault();
    move(next);
  };

  const dayButton = (day: string) => {
    const chosen = day === value;
    const focused = day === cursor;
    const outsideView = day.slice(0, 7) !== view;
    return (
      <button
        key={day}
        ref={focused ? cursorButton : undefined}
        type="button"
        tabIndex={focused ? 0 : -1}
        disabled={!inRange(day, min, max)}
        aria-label={formatDay(day, lang, 'long')}
        aria-pressed={chosen}
        aria-current={day === today ? 'date' : undefined}
        onClick={() => onPick(day)}
        className={`pressable tabular grid size-10 place-items-center rounded-full text-subheadline hover:bg-fill disabled:cursor-default disabled:opacity-40 ${outsideView ? 'text-ink-2' : 'text-ink'} ${chosen ? 'bg-fill-strong font-medium' : ''} ${day === today ? 'ring-1 ring-accent' : ''}`}
      >
        {formatNumber(Number(day.slice(8, 10)), lang)}
      </button>
    );
  };

  return (
    <Popover anchor={anchor} label={t('calendar.label')} onClose={onClose}>
      <div ref={root} onKeyDown={onKeyDown} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label={t('calendar.previous')}
            disabled={!canPrevious}
            onClick={() => move((day) => shiftMonth(day, -1))}
            className="pressable grid size-10 place-items-center rounded-full text-ink hover:bg-fill disabled:opacity-40"
          >
            <AnimatedIcon icon={ChevronLeftIcon} size={18} className="rtl:-scale-x-100" aria-hidden />
          </button>
          <p aria-live="polite" className="text-headline text-ink">{formatMonthYear(`${view}-01`, lang)}</p>
          <button
            type="button"
            aria-label={t('calendar.next')}
            disabled={!canNext}
            onClick={() => move((day) => shiftMonth(day, 1))}
            className="pressable grid size-10 place-items-center rounded-full text-ink hover:bg-fill disabled:opacity-40"
          >
            <AnimatedIcon icon={ChevronRightIcon} size={18} className="rtl:-scale-x-100" aria-hidden />
          </button>
        </div>
        <div aria-hidden className="grid grid-cols-7 gap-1">
          {weekRow.map((day) => (
            <span key={day} className="grid h-6 place-items-center text-footnote text-ink-2">
              {formatWeekdayHead(day, lang)}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">{days.map(dayButton)}</div>
      </div>
    </Popover>
  );
}
