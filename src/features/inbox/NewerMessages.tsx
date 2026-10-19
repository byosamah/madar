import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';

/**
 * The plain button under a window of messages that ends before the newest message (chat design 2026-10-19, item 17): a chat that
 * opens at an old message shows a page, and newer messages follow it. A press goes to the newest page. It is no badge and no motion.
 */
export function NewerMessages({ onShow }: { onShow: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center border-t border-hairline py-1">
      <Button variant="plain" onClick={onShow}>{t('chat.newerMessages')}</Button>
    </div>
  );
}
