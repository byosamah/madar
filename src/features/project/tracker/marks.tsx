import { ArrowDownLeft, ArrowUpRight, FileText, Landmark, MessageCircle, Users, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TrackerDirection, TrackerType } from '../../../api/contract/entities';
import { counted } from '../../../lib/grammar';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { MessageCircleIcon } from '../../../components/icons/animated/message-circle';

const ICON: Record<TrackerType, LucideIcon> = { meeting: Users, message: MessageCircle, file: FileText, balady: Landmark };

/** The icon of an entry type. The big type buttons use the animated icons where the set has one. */
export function TypeIcon({ type, size = 18, animated = false }: { type: TrackerType; size?: number; animated?: boolean }) {
  if (animated && type === 'message') return <AnimatedIcon icon={MessageCircleIcon} size={size} aria-hidden />;
  if (animated && type === 'file') return <AnimatedIcon icon={FileTextIcon} size={size} aria-hidden />;
  const Icon = ICON[type];
  return <Icon size={size} aria-hidden />;
}

/** The arrow for who sent it. It flips in Arabic, so "from the client" still points toward the office. The words stay for a screen reader. */
export function DirectionMark({ direction }: { direction: TrackerDirection }) {
  const { t } = useTranslation();
  const Arrow = direction === 'in' ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className="inline-flex shrink-0 text-ink-2">
      <Arrow size={16} aria-hidden className="rtl:-scale-x-100" />
      <span className="sr-only">{t(`tracker.direction.${direction}`)}</span>
    </span>
  );
}

/** "Today" or "5 days": how long ago the exchange was. */
export function ageText(t: Parameters<typeof counted>[0], days: number): string {
  return days === 0 ? t('tracker.ageToday') : counted(t, 'tracker.age', days);
}
