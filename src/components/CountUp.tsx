import { useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

// Tests read numbers at once, so the count only runs in the browser.
const ANIMATE = import.meta.env.MODE !== 'test';
const seen = new Set<string>();

/**
 * Motion moment 4: a number counts up from zero once per visit (ease-out over 900 ms), then stays still.
 * React always renders the final text; the count only paints the steps in between.
 */
export function CountUp({ id, value, format }: { id: string; value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const final = format(value);
  // The format function is new on every render; a ref keeps a re-render from stopping the count.
  const formatRef = useRef(format);
  formatRef.current = format;
  useEffect(() => {
    const node = ref.current;
    if (!ANIMATE || reduce || !node || seen.has(id) || value === 0) return;
    seen.add(id);
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      const eased = 1 - (1 - p) ** 3;
      node.textContent = formatRef.current(p < 1 ? Math.round(value * eased) : value);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      node.textContent = formatRef.current(value);
    };
  }, [id, value, reduce]);
  return <span ref={ref} className="tabular">{final}</span>;
}
