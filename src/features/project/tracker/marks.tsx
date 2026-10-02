import { useTranslation } from 'react-i18next';
import type { TrackerDirection, TrackerType } from '../../../api/contract/entities';
import { counted } from '../../../lib/grammar';
import { AnimatedIcon, type AnimatedIconComponent } from '../../../components/icons/AnimatedIcon';
import { ArrowDownLeftIcon } from '../../../components/icons/animated/arrow-down-left';
import { ArrowUpRightIcon } from '../../../components/icons/animated/arrow-up-right';
import { ClipboardCheckIcon } from '../../../components/icons/animated/clipboard-check';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { MessageCircleIcon } from '../../../components/icons/animated/message-circle';
import { StampIcon } from '../../../components/icons/animated/stamp';
import { UsersIcon } from '../../../components/icons/animated/users';

// Every icon moves (owner rule, 2026-10-01). Balady is the permit stamp.
const ICON: Record<TrackerType, AnimatedIconComponent> = { meeting: UsersIcon, message: MessageCircleIcon, file: FileTextIcon, balady: StampIcon, other: ClipboardCheckIcon };

/** The icon of an entry type. It plays when its button or row is hovered or focused. */
export function TypeIcon({ type, size = 18 }: { type: TrackerType; size?: number; animated?: boolean }) {
  return <AnimatedIcon icon={ICON[type]} size={size} aria-hidden />;
}

/** The arrow for who sent it. It flips in Arabic, so "from the client" still points toward the office. The words stay for a screen reader. */
export function DirectionMark({ direction }: { direction: TrackerDirection }) {
  const { t } = useTranslation();
  const Arrow = direction === 'in' ? ArrowDownLeftIcon : ArrowUpRightIcon;
  return (
    <span data-direction={direction} className="inline-flex shrink-0 text-ink-2">
      <AnimatedIcon icon={Arrow} size={16} aria-hidden className="rtl:-scale-x-100" />
      <span className="sr-only">{t(`tracker.direction.${direction}`)}</span>
    </span>
  );
}

/** "Today" or "5 days": how long ago the exchange was. */
export function ageText(t: Parameters<typeof counted>[0], days: number): string {
  return days === 0 ? t('tracker.ageToday') : counted(t, 'tracker.age', days);
}
