import { useTranslation } from 'react-i18next';
import type { UserCard } from '../api/contract/views';
import { Avatar } from './Avatar';

/** The leader first, then up to three team members, then "+N" (spec 4.1). */
export function AvatarStack({ leader, team, max = 3, size = 28 }: { leader: UserCard | null; team: UserCard[]; max?: number; size?: number }) {
  const { t } = useTranslation();
  const shown = [...(leader ? [leader] : []), ...team.slice(0, max)];
  const extra = team.length - Math.min(team.length, max);
  return (
    <div className="flex shrink-0 items-center">
      {shown.map((person, i) => (
        <span key={person.id} className={`rounded-full ring-2 ring-card ${i > 0 ? '-ms-2' : ''}`}>
          <Avatar user={person} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span style={{ width: size, height: size }} className="-ms-2 inline-flex items-center justify-center rounded-full bg-fill-strong text-caption font-semibold text-label ring-2 ring-card">
          {t('projects.morePeople', { n: extra })}
        </span>
      )}
    </div>
  );
}
