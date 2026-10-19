import { useTranslation } from 'react-i18next';
import { glowOf } from '../../components/Avatar';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { UsersIcon } from '../../components/icons/animated/users';

/**
 * The one picture of a group (UX audit 2026-10-19, chats-08): the soft glow of the group, made from its id, with a small people
 * icon. It has the size of every other row picture, so it never covers the title. It shows no face, so the row and the header
 * look the same and no stack of faces sits in a list (DESIGN.md).
 */
export function GroupPicture({ id, size = 40 }: { id: string; size?: number }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t('chat.groupChat')}
      style={{ width: size, height: size, background: glowOf(id) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-ink ring-1 ring-inset ring-ink/10"
    >
      <AnimatedIcon icon={UsersIcon} size={Math.round(size * 0.45)} aria-hidden />
    </span>
  );
}
