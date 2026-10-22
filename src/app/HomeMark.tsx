import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { MadarMark } from '../components/MadarMark';

/** The Madar mark at the top start of the screen (owner, 2026-10-04). A press opens Home, as on most sites. */
export function HomeMark({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Link to="/" aria-label={t('nav.madarHome')} className={`pressable grid size-11 place-items-center rounded-[14px] ${className ?? ''}`}>
      <MadarMark size={36} />
    </Link>
  );
}
