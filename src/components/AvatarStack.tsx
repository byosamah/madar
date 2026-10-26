import { motion } from 'motion/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { UserCard } from '../api/contract/views';
import { usePersonName } from '../app/personName';
import { Avatar } from './Avatar';

type Tip = { name: string; x: number; y: number };

/**
 * The leader first (bigger when `leaderSize` is set), then up to three team members, then "+N" (spec 4.1). The pictures
 * overlap by 4 px only, so the ring of the next one never hides initials, and "+N" keeps its order in Arabic.
 * The leader stands out (owner, 2026-10-26, fbk_060): a 1.5 px ring in the ink color with a 2 px gap in the surface color inside it, and the
 * first team picture sits 4 px away from that ring. The gap and the ring draw outside the box (a negative margin), so the box of the leader
 * is as big as its picture and a row never grows. Every stack that has a leader gets the same ring, so one meaning has one look.
 * Each picture box is a flex box: a photo (an inline img) in a plain box sat on a text line, the box grew a gap under it, and the ring
 * drew an oval with the photo at its top (production, 2026-10-26). Initials have no such gap, so the prototype did not show it.
 * One hidden person takes the width of "+1" anyway, so that person's picture shows instead (PRJ-18). "+N" names the hidden people on
 * hover and to a screen reader.
 * On hover the pictures slide apart and each one names its person (owner, 2026-10-01, after shadcn studio avatar-18).
 * The name label sits in the page layer, so a list with rounded, clipped corners never cuts it.
 */
export function AvatarStack({
  leader, team, max = 3, size = 28, leaderSize = size,
}: { leader: UserCard | null; team: UserCard[]; max?: number; size?: number; leaderSize?: number }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const [tip, setTip] = useState<Tip | null>(null);
  const fits = team.length - max === 1 ? team.length : Math.min(team.length, max);
  const shown = [...(leader ? [leader] : []), ...team.slice(0, fits)];
  const hidden = team.slice(fits);
  const extra = hidden.length;
  const hiddenNames = hidden.map((person) => nameOf(person)).join(', ');
  const hasLeader = Boolean(leader);
  const slide = 'transition-[margin] duration-300 ease-in-out motion-reduce:transition-none';
  const show = (name: string) => (event: React.MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setTip({ name, x: box.left + box.width / 2, y: box.top });
  };
  return (
    <div className="group/stack flex shrink-0 items-center" onMouseLeave={() => setTip(null)}>
      {shown.map((person, i) => {
        const isLeader = hasLeader && i === 0;
        const name = isLeader ? t('people.leaderName', { name: nameOf(person) }) : nameOf(person);
        // The first team picture sits 4 px from the ring of the leader; the others overlap by 4 px as before.
        const place = i === 0 ? '' : hasLeader && i === 1 ? 'ms-2 group-hover/stack:ms-3' : '-ms-1 group-hover/stack:ms-1';
        return (
          <span
            key={person.id}
            data-leader={isLeader ? '' : undefined}
            onMouseEnter={show(name)}
            onMouseLeave={() => setTip(null)}
            className={`flex shrink-0 rounded-full ${isLeader ? '-m-0.5 bg-card p-0.5 ring-[1.5px] ring-ink' : 'ring-2 ring-card'} ${slide} ${place}`}
          >
            <Avatar user={person} size={isLeader ? leaderSize : size} label={isLeader ? name : undefined} />
          </span>
        );
      })}
      {extra > 0 && (
        <span
          role="img"
          aria-label={t('people.moreNames', { names: hiddenNames })}
          onMouseEnter={show(hiddenNames)}
          onMouseLeave={() => setTip(null)}
          style={{ width: size, height: size }}
          className={`-ms-1 inline-flex items-center justify-center rounded-full bg-fill-strong text-caption font-semibold text-label ring-2 ring-card group-hover/stack:ms-1 ${slide}`}
        >
          <bdi dir="ltr">{t('projects.morePeople', { n: extra })}</bdi>
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
