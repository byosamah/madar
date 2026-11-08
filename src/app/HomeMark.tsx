import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { MadarMark } from '../components/MadarMark';
import { useLang } from './lang';
import { useCall } from './runtime';

/** The product name and its Arabic form: an enterprise whose name is one of them has set no name of its own (session.get falls back to them). */
const PRODUCT = ['Madar', 'مدار'];

/**
 * The mark at the top start of the screen (owner, 2026-10-04). A press opens Home, as on most sites. With a name or a logo of the enterprise
 * (Madar enterprises, design 5.10) it shows the logo of the enterprise in the same 36 px frame, and on a desk the name next to it, in the
 * language of the screen. A phone shows the logo only. Without an enterprise (the prototype) or with no name and no logo it shows the Madar mark as before.
 */
export function HomeMark({ className }: { className?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const enterprise = useCall('session.get', {}).data?.enterprise;
  const name = enterprise ? (lang === 'ar' ? enterprise.nameAr : enterprise.name) : '';
  const named = enterprise !== undefined && !PRODUCT.includes(name);
  return (
    <Link
      to="/"
      aria-label={named ? name : t('nav.madarHome')}
      className={`pressable ${named ? 'inline-flex h-11 min-w-11 items-center gap-2 rounded-[14px] pe-3 ps-1' : 'grid size-11 place-items-center rounded-[14px]'} ${className ?? ''}`}
    >
      {enterprise?.logo ? <img src={enterprise.logo} alt="" width={36} height={36} className="size-9 shrink-0 object-contain" /> : <MadarMark size={36} />}
      {named && <span className="hidden max-w-48 truncate text-headline text-ink sm:inline"><bdi>{name}</bdi></span>}
    </Link>
  );
}
