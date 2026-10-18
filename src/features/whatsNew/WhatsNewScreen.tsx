import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { ScreenTitle } from '../../components/ScreenTitle';
import { formatDay } from '../../lib/dates';
import { WHATS_NEW, type WhatsNewEntry } from '../../whatsNew/entries';
import { markSeen } from '../../whatsNew/seen';

/** The entries of each day, in the order of the list. */
function groupByDay(entries: readonly WhatsNewEntry[]): { day: string; entries: WhatsNewEntry[] }[] {
  const groups: { day: string; entries: WhatsNewEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last?.day === entry.day) last.entries.push(entry);
    else groups.push({ day: entry.day, entries: [entry] });
  }
  return groups;
}

/**
 * What's new (fbk_018): the changes of each release, in plain words for the team. Opening the page marks the newest entry as
 * seen for the person, so the person menu shows its item in normal weight. The page has no button.
 */
export function WhatsNewScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const userId = useCall('session.get', {}).data?.user.id;
  useEffect(() => {
    if (userId) markSeen(userId, WHATS_NEW[0].id);
  }, [userId]);
  return (
    <>
      <ScreenTitle title={t('whatsNew.title')} />
      <div className="flex flex-col gap-5">
        {groupByDay(WHATS_NEW).map((group) => (
          <section key={group.day} aria-labelledby={`whats-new-${group.day}`} className="surface flex flex-col gap-4 rounded-card p-5">
            <h2 id={`whats-new-${group.day}`} className="text-footnote text-ink-2">{formatDay(group.day, lang)}</h2>
            {group.entries.map((entry) => (
              <article key={entry.id} className="flex flex-col gap-1">
                <h3 className="text-headline text-ink">{t(`whatsNew.items.${entry.id}.title`)}</h3>
                <p className="text-body text-ink-2">{t(`whatsNew.items.${entry.id}.body`)}</p>
              </article>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
