import { useTranslation } from 'react-i18next';
import { useLang } from '../app/lang';
import { ageOf } from '../lib/age';
import { formatDay, now } from '../lib/dates';

/** "5m", "2h", "3d", "2w", then the date (spec 4.1). */
export function Age({ stamp }: { stamp: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const age = ageOf(stamp, now());
  const text = age.unit === 'date' ? formatDay(age.day, lang) : age.unit === 'now' ? t('time.now') : t(`time.${age.unit}`, { n: age.n });
  return <time dateTime={stamp} className="tabular whitespace-nowrap">{text}</time>;
}
