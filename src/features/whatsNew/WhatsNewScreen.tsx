import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { can } from '../../api/permissions';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { ScreenTitle } from '../../components/ScreenTitle';
import { formatDay } from '../../lib/dates';
import { WHATS_NEW, type WhatsNewEntry } from '../../whatsNew/entries';
import { markSeen, readSeen } from '../../whatsNew/seen';

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
 * What's new (fbk_018): the changes of each release, in plain words for the team. The page shows a person only the entries that the
 * person can use (UX audit 2026-10-19, chats-14), and ends an entry that names a screen with one quiet link "Open". An entry newer
 * than the last one the person saw carries the word "New". The page marks the newest entry as seen when the person opens it, so the
 * person menu and the Home line drop their mark. The page has no button.
 */
export function WhatsNewScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useCall('session.get', {}).data;
  const userId = session?.user.id;
  // The entry that the person saw before this visit. It is read once, before the visit marks the newest entry as seen.
  const [seenBefore, setSeenBefore] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!userId) return;
    // Read the mark first: the updater of a state runs later, after the line below has written the newest entry.
    const before = readSeen(userId);
    setSeenBefore((known) => (known === undefined ? before : known));
    markSeen(userId, WHATS_NEW[0].id);
  }, [userId]);
  // With no known seen entry (a first visit), every entry is new, so the word would tell nothing and the page leaves it out.
  const seenAt = seenBefore ? WHATS_NEW.findIndex((entry) => entry.id === seenBefore) : -1;
  const shown = WHATS_NEW.filter((entry) => !entry.right || (session !== undefined && can(session.authority, entry.right)));
  return (
    <>
      <ScreenTitle title={t('whatsNew.title')} />
      <div className="flex flex-col gap-5">
        {groupByDay(shown).map((group) => (
          <section key={group.day} aria-labelledby={`whats-new-${group.day}`} className="surface flex flex-col gap-4 rounded-card p-5">
            <h2 id={`whats-new-${group.day}`} className="text-footnote text-ink-2">{formatDay(group.day, lang)}</h2>
            {group.entries.map((entry) => {
              const title = t(`whatsNew.items.${entry.id}.title`);
              const isNew = seenAt > 0 && WHATS_NEW.findIndex((one) => one.id === entry.id) < seenAt;
              return (
                <article key={entry.id} className="flex max-w-[40rem] flex-col gap-1">
                  <h3 className="flex items-baseline gap-2 text-headline text-ink">
                    {title}
                    {isNew && <span className="text-footnote font-medium text-ink-2">{t('whatsNew.newMark')}</span>}
                  </h3>
                  <p className="text-body text-ink-2">{t(`whatsNew.items.${entry.id}.body`)}</p>
                  {entry.to && (
                    <Link to={entry.to} aria-label={t('whatsNew.openItem', { title })} className="pressable -my-2 self-start py-2 text-subheadline font-medium text-link hover:underline">
                      {t('whatsNew.open')}
                    </Link>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
