import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GeoPoint } from '../../api/contract/entities';
import { useLang } from '../../app/lang';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { samePoint } from '../../lib/geo';
import { addressOf } from '../../lib/placeAddress';
import { PinPicker } from './PinPicker';

/**
 * The one sheet that sets a pin (audit 2026-10-19, PRJ-13). The Dashboard and the project form use it, so the task works one way:
 * the pin picker edits a draft, Cancel drops the draft and keeps the old pin, and "Use this place" hands the draft to the screen.
 * The screen decides what a use means: the form keeps it until "Save changes", the Dashboard saves it at once.
 *
 * The Location of a project is the address of its pin (owner, 2026-10-19), so "Use this place" hands over the point and its address:
 * the name of a search hit, else one lookup at OpenStreetMap when the person presses the button (never while the pin moves). A pin
 * that did not move keeps the address it had. A failed lookup gives an empty address, and the pin still goes.
 */
export function PinSheet({ open, onOpenChange, initial, address = '', description, busy = false, onUse }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: GeoPoint | null;
  /** The address that the initial pin has now. An unchanged pin hands it back, with no lookup. */
  address?: string;
  description?: string;
  busy?: boolean;
  /** The point of the draft, and its address ('' when there is none). */
  onUse: (point: GeoPoint, address: string) => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const [draft, setDraft] = useState<GeoPoint | null>(initial);
  const [place, setPlace] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const start = useRef(initial);
  start.current = initial;
  // The number of the last press or opening: an answer that comes after a Cancel or a new opening is dropped.
  const turn = useRef(0);
  // Each opening starts from the saved pin, so a closed sheet never keeps an old draft.
  useEffect(() => {
    turn.current += 1;
    setLooking(false);
    if (open) {
      setDraft(start.current);
      setPlace(null);
    }
  }, [open]);

  // A close of any kind (Cancel, Escape, a press outside) drops a lookup that still runs.
  const change = (next: boolean) => {
    if (!next) {
      turn.current += 1;
      setLooking(false);
    }
    onOpenChange(next);
  };

  async function use() {
    if (!draft || looking) return;
    if (start.current && samePoint(draft, start.current)) {
      onUse(draft, address);
      return;
    }
    if (place) {
      onUse(draft, place);
      return;
    }
    const mine = ++turn.current;
    setLooking(true);
    const found = await addressOf(draft, lang);
    if (mine !== turn.current) return;
    setLooking(false);
    onUse(draft, found);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={change}
      title={t('map.pinSheet.title')}
      description={description}
      footer={(
        <>
          <Button onClick={() => change(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={draft === null || busy || looking} onClick={() => void use()}>
            {looking ? t('map.pinSheet.looking') : t('map.pinSheet.use')}
          </Button>
        </>
      )}
    >
      {open && <PinPicker value={draft} onChange={setDraft} onPlace={setPlace} />}
    </Sheet>
  );
}
