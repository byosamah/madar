import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { MadarMark } from '../components/MadarMark';
import { LanguageSwitch, ThemeSwitch } from './SiteControls';

/**
 * The header of the site, one row on every screen: the brand on one side, then the theme switch, the language switch and (after sign-in) Sign out.
 * On a phone the two switches are icon-only squares of 44 px. The brand is one piece (never wraps); on a very narrow screen its end shortens.
 * The row keeps the normal side margin of the shell: nothing pulls a button toward the edge.
 */
export function SiteHeader({ onSignOut }: { onSignOut?: () => void }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between gap-2 pb-6">
      {/* On a phone the brand is a little smaller, so the whole name fits next to the three controls at 390 px. */}
      <p data-madar-brand="" className="flex min-w-0 items-center gap-2 text-headline text-ink max-sm:text-subheadline max-sm:font-bold sm:gap-2.5">
        <MadarMark size={28} />
        <bdi className="min-w-0 truncate whitespace-nowrap">{t('enterprises.title')}</bdi>
      </p>
      <div className="flex shrink-0 items-center">
        <ThemeSwitch />
        <LanguageSwitch />
        {onSignOut && <Button className="max-sm:px-3 sm:ms-2" onClick={onSignOut}>{t('platformSite.signOut')}</Button>}
      </div>
    </header>
  );
}
