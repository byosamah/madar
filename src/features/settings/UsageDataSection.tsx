import { useTranslation } from 'react-i18next';
import { SettingsSection as Section } from './Section';

/**
 * The one line that tells the team what Madar records (insight design, section 8, owner 2026-10-25). It has no control: the owner
 * turned down a pop-up, an ask and a switch. The words are the same in both builds, because the line describes the real Madar.
 */
export function UsageDataSection() {
  const { t } = useTranslation();
  return (
    <Section title={t('insight.title')}>
      <p className="text-subheadline text-ink-2">{t('insight.body')}</p>
    </Section>
  );
}

/** The same paragraph as quiet text at the end of the Me hub on a phone. */
export function UsageDataNote() {
  const { t } = useTranslation();
  return <p className="px-1 text-footnote text-label-2">{t('insight.body')}</p>;
}
