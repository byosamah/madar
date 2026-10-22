import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { usePressReads } from '../../app/pressReads';
import { useCall } from '../../app/runtime';
import { SegmentedControl } from '../../components/SegmentedControl';

type View = 'chats' | 'notifications';
const ADDRESS: Record<View, string> = { chats: '/inbox', notifications: '/notifications' };

/**
 * The switch of the phone Inbox (Direction D): Chats and Notifications under one title. It reads the address, as the Work switch
 * does, and a press goes to the other address. The old addresses keep working, so a push line or a bookmark opens the right view.
 * Each segment has its own count: the unread chats, and the notices that need action. A count of 0 shows no number. The shell joins
 * the two addresses in one screen key, so the thumb slides across the change. A press on a segment starts its reads at pointer down.
 */
export function InboxViews() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const start = usePressReads();
  const unread = useCall('chats.unreadCount', {}).data?.unread ?? 0;
  const notices = useCall('notifications.count', {}).data?.badge ?? 0;
  const view: View = pathname === '/notifications' ? 'notifications' : 'chats';
  return (
    <div className="pb-4">
      <SegmentedControl<View>
        fill
        layoutId="inbox-views"
        label={t('inbox.view.label')}
        value={view}
        onOptionPointerDown={(next) => start(ADDRESS[next])}
        onChange={(next) => {
          if (next !== view) void navigate(ADDRESS[next]);
        }}
        options={[
          { value: 'chats', label: t('inbox.view.chats'), count: unread, countLabel: t('nav.inboxUnread', { count: unread }) },
          { value: 'notifications', label: t('screens.notifications'), count: notices, countLabel: t('nav.inboxBadge', { count: notices }) },
        ]}
      />
    </div>
  );
}
