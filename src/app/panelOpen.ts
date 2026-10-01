import { useEffect } from 'react';

let open = 0;

/** While a modal panel is open, the page behind steps back (motion moment 5). Panels can stack, so this counts them. */
export function usePanelOpen(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    open += 1;
    document.documentElement.setAttribute('data-panel-open', '');
    // The page behind a modal panel takes no focus and leaves the accessibility tree; the dim layer shows it is out of reach.
    const page = document.querySelector<HTMLElement>('.app-page');
    if (page) page.inert = true;
    return () => {
      open -= 1;
      if (open === 0) {
        document.documentElement.removeAttribute('data-panel-open');
        if (page) page.inert = false;
      }
    };
  }, [active]);
}
