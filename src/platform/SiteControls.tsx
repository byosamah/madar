import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../api/contract/entities';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { LanguagesIcon } from '../components/icons/animated/languages';
import { MoonIcon } from '../components/icons/animated/moon';
import { SunIcon } from '../components/icons/animated/sun';
import { applyTheme, startTheme, type SiteTheme } from './theme';
import { applyLanguage } from './words';

const BUTTON = 'pressable inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-subheadline text-ink-2 hover:bg-fill';

/** The language switch of the site: one button that names the other language. The words and the direction change together. */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const next: Language = i18n.language === 'ar' ? 'en' : 'ar';
  return (
    <button type="button" lang={next} onClick={() => applyLanguage(next, true)} className={BUTTON}>
      <AnimatedIcon icon={LanguagesIcon} size={18} aria-hidden />
      {t(`settings.languages.${next}`)}
    </button>
  );
}

/** The theme switch of the site: light and dark. */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<SiteTheme>(() => startTheme());
  const next: SiteTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next, true);
        setTheme(next);
      }}
      className={BUTTON}
    >
      <AnimatedIcon icon={next === 'dark' ? MoonIcon : SunIcon} size={18} aria-hidden />
      {t(next === 'dark' ? 'platformSite.theme.toDark' : 'platformSite.theme.toLight')}
    </button>
  );
}
