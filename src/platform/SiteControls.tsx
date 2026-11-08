import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../api/contract/entities';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { LanguagesIcon } from '../components/icons/animated/languages';
import { MoonIcon } from '../components/icons/animated/moon';
import { SunIcon } from '../components/icons/animated/sun';
import { applyTheme, startTheme, type SiteTheme } from './theme';
import { applyLanguage } from './words';

/** A phone shows the icon alone in a 44 px square. A desk (sm and up) adds the text label. */
const BUTTON = 'pressable inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-full text-subheadline text-ink-2 hover:bg-fill sm:w-auto sm:px-3';
const LABEL = 'hidden sm:inline';

/**
 * The language switch of the site: one button for the other language. The words and the direction change together. Its name and title are in the
 * language of the screen and hold the name of the other language as written in that language. The visible label is only on a desk.
 */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const next: Language = i18n.language === 'ar' ? 'en' : 'ar';
  const label = t('platformSite.language.change', { language: t(`settings.languages.${next}`) });
  return (
    <button type="button" aria-label={label} title={label} onClick={() => applyLanguage(next, true)} className={BUTTON}>
      <AnimatedIcon icon={LanguagesIcon} size={18} aria-hidden />
      <span lang={next} className={LABEL}>{t(`settings.languages.${next}`)}</span>
    </button>
  );
}

/** The theme switch of the site: light and dark. */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<SiteTheme>(() => startTheme());
  const next: SiteTheme = theme === 'dark' ? 'light' : 'dark';
  const label = t(next === 'dark' ? 'platformSite.theme.toDark' : 'platformSite.theme.toLight');
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        applyTheme(next, true);
        setTheme(next);
      }}
      className={BUTTON}
    >
      <AnimatedIcon icon={next === 'dark' ? MoonIcon : SunIcon} size={18} aria-hidden />
      <span className={LABEL}>{label}</span>
    </button>
  );
}
