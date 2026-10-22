import { useEffect, useState } from 'react';
import { usePageVisible } from '../../app/usePageVisible';
import { now } from '../../lib/dates';

const minuteOf = () => Math.floor(now().getTime() / 60_000);

/**
 * The minute count of the clock of Madar (`now()`), and a new render of the list each 60 s (phone design D, the Meetings view). One tick
 * serves the whole list: a card moves to "Now" and "Done", and its Join appears, on a screen that stays open. The tick stops while the
 * page is hidden, and it reads the clock again at once when the page shows, so a card never waits a minute to catch up.
 * `enabled` is false on a desk, where the list keeps its render-time clock.
 */
export function useMinuteTick(enabled: boolean): number {
  const visible = usePageVisible();
  const [minute, setMinute] = useState(minuteOf);
  useEffect(() => {
    if (!enabled || !visible) return undefined;
    setMinute(minuteOf());
    const timer = window.setInterval(() => setMinute(minuteOf()), 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, visible]);
  return minute;
}
