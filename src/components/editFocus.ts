import { useEffect, useRef } from 'react';

/**
 * The focus of an inline edit box (audit 2026-10-03, F-1). The actions button of the item hides while the box shows, so the
 * focus fell to the page body, and the next Tab went to the box for a new comment. Edit now moves the focus into the box, and
 * Cancel or Save gives it back to the actions button. Put `field` on the text box and `actions` on a box around the button.
 */
export function useEditFocus(editing: boolean) {
  const field = useRef<HTMLTextAreaElement>(null);
  const actions = useRef<HTMLSpanElement>(null);
  const before = useRef(editing);
  useEffect(() => {
    if (editing === before.current) return;
    before.current = editing;
    if (editing) {
      const box = field.current;
      box?.focus();
      box?.setSelectionRange(box.value.length, box.value.length);
      return;
    }
    // Only a focus that went nowhere comes back: to the page, to the open sheet itself, or still in this item.
    const here = document.activeElement;
    const item = actions.current?.closest('li');
    if (!here || here === document.body || here.getAttribute('role') === 'dialog' || item?.contains(here)) {
      actions.current?.querySelector<HTMLElement>('button')?.focus();
    }
  }, [editing]);
  return { field, actions };
}
