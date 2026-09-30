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
        setCompact((current) => nextCompact(current, previous, y));
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
