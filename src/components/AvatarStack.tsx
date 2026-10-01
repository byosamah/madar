import { motion } from 'motion/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { UserCard } from '../api/contract/views';
import { Avatar } from './Avatar';

type Tip = { name: string; x: number; y: number };

/**
 * The leader first (bigger when `leaderSize` is set), then up to three team members, then "+N" (spec 4.1).
 * On hover the pictures slide apart and each one names its person (owner, 2026-10-01, after shadcn studio avatar-18).
 * The name label sits in the page layer, so a list with rounded, clipped corners never cuts it.
 */
export function AvatarStack({
  leader, team, max = 3, size = 28, leaderSize = size,
}: { leader: UserCard | null; team: UserCard[]; max?: number; size?: number; leaderSize?: number }) {
  const { t } = useTranslation();
  const [tip, setTip] = useState<Tip | null>(null);
  const shown = [...(leader ? [leader] : []), ...team.slice(0, max)];
  const extra = team.length - Math.min(team.length, max);
  const slide = 'transition-[margin] duration-300 ease-in-out motion-reduce:transition-none';
  const show = (name: string) => (event: React.MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setTip({ name, x: box.left + box.width / 2, y: box.top });
  };
  return (
    <div className="group/stack flex shrink-0 items-center" onMouseLeave={() => setTip(null)}>
      {shown.map((person, i) => (
        <span
          key={person.id}
          onMouseEnter={show(person.name)}
          onMouseLeave={() => setTip(null)}
          className={`rounded-full ring-2 ring-card ${slide} ${i > 0 ? '-ms-1.5 group-hover/stack:ms-1' : ''}`}
        >
          <Avatar user={person} size={leader && i === 0 ? leaderSize : size} />
        </span>
      ))}
      {extra > 0 && (
        <span style={{ width: size, height: size }} className={`-ms-1.5 inline-flex items-center justify-center rounded-full bg-fill-strong text-caption font-semibold text-label ring-2 ring-card group-hover/stack:ms-1 ${slide}`}>
          {t('projects.morePeople', { n: extra })}
        </span>
      )}
      {tip && createPortal(
        <span className="pointer-events-none fixed z-50" style={{ left: tip.x, top: tip.y - 8, transform: 'translate(-50%, -100%)' }}>
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="block whitespace-nowrap rounded-lg bg-ink px-2.5 py-1 text-caption font-semibold text-bg shadow-lg"
          >
            {tip.name}
          </motion.span>
        </span>,
        document.body,
      )}
    </div>
  );
}
