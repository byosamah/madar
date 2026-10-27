import { useTranslation } from 'react-i18next';
import type { TrackerDirection, TrackerType } from '../../../api/contract/entities';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { sidesOf, waitingFor } from '../../../lib/tracker';

/** The word of the wait switch: "Needs a reply" while the office owes the answer, else "Waiting for the client". */
export function waitLabelKey(direction: TrackerDirection): 'tracker.needsReply' | 'tracker.waitingToggle' {
  return waitingFor(direction) === 'us' ? 'tracker.needsReply' : 'tracker.waitingToggle';
}

/** The side of an entry, as a choice. A type with only one side shows nothing. The quick log and the entry sheet both use it. */
export function DirectionPicker({ type, direction, onChange }: { type: TrackerType; direction: TrackerDirection; onChange: (direction: TrackerDirection) => void }) {
  const { t } = useTranslation();
  const sides = sidesOf(type);
  if (sides.length <= 1) return null;
  return (
    <SegmentedControl
      label={t('tracker.directionLabel')}
      value={direction}
      options={sides.map((value) => ({ value, label: t(`tracker.direction.${value}`) }))}
      onChange={onChange}
    />
  );
}
