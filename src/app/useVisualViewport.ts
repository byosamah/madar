import { useEffect, useMemo, useState } from 'react';

export type ViewportBox = { height: number; offsetTop: number };
type ViewportState = ViewportBox & { scale: number };

function read(): ViewportState | null {
  const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
  return viewport ? { height: viewport.height, offsetTop: viewport.offsetTop, scale: viewport.scale ?? 1 } : null;
}

/** The visual viewport with its zoom scale. Only `useKeyboardOpen` needs the scale. */
export function useViewportState(): ViewportState | null {
  const [state, setState] = useState<ViewportState | null>(read);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const update = () => {
      const next = read();
      // One object for each change, so a render without a change does not loop.
      setState((old) => (old && next && old.height === next.height && old.offsetTop === next.offsetTop && old.scale === next.scale ? old : next));
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return state;
}

/**
 * The visible part of the page, which shrinks when the keyboard opens on a phone. It follows `visualViewport` resize and
 * scroll events. It gives `null` where the API is absent: the caller then uses `100dvh`.
 */
export function useVisualViewport(): ViewportBox | null {
  const state = useViewportState();
  const height = state?.height;
  const offsetTop = state?.offsetTop;
  return useMemo(() => (height === undefined || offsetTop === undefined ? null : { height, offsetTop }), [height, offsetTop]);
}
