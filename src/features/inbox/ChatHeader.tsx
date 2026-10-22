import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { SearchIcon } from '../../components/icons/animated/search';
import { ChatBackLink } from './chatBack';

/**
 * The head of an open chat on a phone (Direction D). It is 56 px high plus the top safe area, with a hairline under it. The order is the
 * Back link, the picture of 38 px (`lead`, none for a to-do thread), the title on one line with the state line under it, the Search
 * icon and the options (`action`). The title cuts at its end in any language: the `<bdi>` is the element that cuts. The Search icon
 * opens the Search screen on its Messages group, for the whole office: there is no search inside one chat.
 */
export function ChatHeader({ lead, title, subtitle, action }: { lead: ReactNode; title: string; subtitle: ReactNode; action: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex h-[calc(56px+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-hairline pe-1 ps-1 pt-[env(safe-area-inset-top)]">
      <ChatBackLink />
      {lead}
      <div className="min-w-0 flex-1">
        <h2 className="min-w-0 text-headline text-ink"><bdi className="block truncate">{title}</bdi></h2>
        <div className="truncate text-footnote text-ink-2">{subtitle}</div>
      </div>
      <Link to="/search?in=messages" aria-label={t('chat.searchMessages')} className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink">
        <AnimatedIcon icon={SearchIcon} size={20} aria-hidden />
      </Link>
      {action}
    </header>
  );
}
