import { useEffect, useState, type RefObject } from 'react';

/**
 * True from the moment the box comes within 400 px of the screen. The small picture asks for its link only then. The chat pictures and the
 * picture rows of the Files tab use it (performance audit 2026-10-21, BG-7). Where the browser has no IntersectionObserver, the box is near
 * at once.
 */
export function useNearView(box: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const node = box.current;
    if (near || !node || typeof IntersectionObserver === 'undefined') return undefined;
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: '400px' });
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [box, near]);
  return near;
}
