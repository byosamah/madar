import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';

/**
 * The three steps that add Madar to the Home Screen of an iPhone or iPad. A page cannot start the install there, so the sheet only
 * shows the steps. It does not import the ask card of Today (track T owns it); it uses the same three words.
 */
export function HomeScreenSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('phoneMe.homeScreenRow')}>
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-subheadline text-ink-2">{t('push.homeScreenLine')}</p>
        <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-subheadline text-ink-2">
          <li>{t('push.homeScreenStep1')}</li>
          <li>{t('push.homeScreenStep2')}</li>
          <li>{t('push.homeScreenStep3')}</li>
        </ol>
      </div>
    </Sheet>
  );
}
