import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../app/lang';
import { ageOf } from '../lib/age';
import { formatDay, now } from '../lib/dates';
import { counted } from '../lib/grammar';

/**
 * Age reads the clock when it renders. A list that stops its rows with React.memo (the comments while a person types, the task
 * history, the Inbox rows) gives a new object here on each of its own renders. So each Age below it still renders and reads the
 * clock in exactly the renders it did before the memo, and the rest of each row does not (performance audit 2026-10-07, RND-3).
 * Outside a provider nothing changes.
 */
export const AgeRefresh = createContext<object>({});

/** "5m", "2h", "3d", "2w", then the date (spec 4.1). */
export function Age({ stamp }: { stamp: string }) {
  useContext(AgeRefresh);
  const { t } = useTranslation();
  const lang = useLang();
  const age = ageOf(stamp, now());
  const text = age.unit === 'date' ? formatDay(age.day, lang) : age.unit === 'now' ? t('time.now') : counted(t, `time.${age.unit}`, age.n);
  return <time dateTime={stamp} className="tabular whitespace-nowrap">{text}</time>;
}
