import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GeoPoint } from '../../api/contract/entities';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { PinPicker } from './PinPicker';

/**
 * The one sheet that sets a pin (audit 2026-10-19, PRJ-13). The Dashboard and the project form use it, so the task works one way:
 * the pin picker edits a draft, Cancel drops the draft and keeps the old pin, and "Use this place" hands the draft to the screen.
 * The screen decides what a use means: the form keeps it until "Save changes", the Dashboard saves it at once.
 */
export function PinSheet({ open, onOpenChange, initial, description, busy = false, onUse }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: GeoPoint | null;
  description?: string;
  busy?: boolean;
  /** The point of the draft, and the name of the place when a search hit set it. */
  onUse: (point: GeoPoint, place: string | null) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<GeoPoint | null>(initial);
  const [place, setPlace] = useState<string | null>(null);
  const start = useRef(initial);
  start.current = initial;
  // Each opening starts from the saved pin, so a closed sheet never keeps an old draft.
  useEffect(() => {
    if (open) {
      setDraft(start.current);
      setPlace(null);
    }
  }, [open]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('map.pinSheet.title')}
      description={description}
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={draft === null || busy} onClick={() => draft && onUse(draft, place)}>{t('map.pinSheet.use')}</Button>
        </>
      )}
    >
      {open && <PinPicker value={draft} onChange={setDraft} onPlace={setPlace} />}
    </Sheet>
  );
}
