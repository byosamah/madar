import { useCallback, useEffect, useRef } from 'react';
import { noteSheet, type SheetName } from './notes';

/**
 * Counts the steps of a main sheet (insight design, section 4): `open` when it opens, `save` when the person saves, and
 * `close_unsaved` when it closes with no save. A sheet that is mounted only while it is open passes `open` as true: its unmount is
 * the close. No person goes with a sheet step. The result is the function to call in the success step of the save.
 */
export function useSheetSteps(name: SheetName, open: boolean): () => void {
  const state = useRef({ open: false, saved: false });
  useEffect(() => {
    if (!open) return undefined;
    state.current = { open: true, saved: false };
    noteSheet(name, 'open');
    return () => {
      const { saved } = state.current;
      state.current.open = false;
      if (!saved) noteSheet(name, 'close_unsaved');
    };
  }, [name, open]);
  return useCallback(() => {
    if (!state.current.open) return;
    state.current.saved = true;
    noteSheet(name, 'save');
  }, [name]);
}
