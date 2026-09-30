import { useEffect, useState } from 'react';
import { nextCompact } from '../lib/scroll';

/** True while the page scrolls down. One reading per frame. */
export function useCompactBars(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let previous = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        // React may run the updater later, so it gets its own copy of the old position.
        const before = previous;
        setCompact((current) => nextCompact(current, before, y));
        previous = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return compact;
}
