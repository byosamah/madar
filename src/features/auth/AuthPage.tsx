import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { LanguagesIcon } from '../../components/icons/animated/languages';
import { MadarMark } from '../../components/MadarMark';
import { ScreenTitle } from '../../components/ScreenTitle';
import type { Language } from '../../api/contract/entities';
import { applyLanguage, initI18n, withWords } from '../../i18n';

/** The language that a person chose before they signed in. The remote main.tsx reads it first (client map 7.4). */
export const LANGUAGE_KEY = 'madar.lang';

/**
 * Switches the language with no session: the page only, and the choice stays in this browser. After sign-in the person's own
 * language from session.get wins (AppearanceSync).
 */
function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const next: Language = i18n.language === 'ar' ? 'en' : 'ar';
  // The words and the direction change together, once the words of that language are there (performance audit BND-7).
  const choose = () => withWords(next, () => {
    initI18n(next);
    applyLanguage(document.documentElement, next);
    try { window.localStorage.setItem(LANGUAGE_KEY, next); } catch { /* blocked storage */ }
  });
  return (
    <button type="button" lang={next} onClick={choose} className="pressable inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-subheadline text-ink-2 hover:bg-fill">
      <AnimatedIcon icon={LanguagesIcon} size={18} aria-hidden />
      {t(`settings.languages.${next}`)}
    </button>
  );
}

/**
 * The frame of a sign-in screen (client map 7.1): outside the shell, as the meeting view is, with the language switch, one title
 * and one panel. One column with a 16 px side margin, so it fits a phone.
 * The top row holds the Madar logo (TASKS.md, Logo): one small mark with the name at the start, the language switch at the end.
 * The mark is hidden from screen readers, because the name is next to it.
 */
export function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] text-ink sm:pt-16">
      <div className="-me-3 flex items-center justify-between gap-3 pb-6">
        <p data-madar-brand="" className="flex items-center gap-2.5 text-headline text-ink">
          <MadarMark size={28} />
          {t('app.name')}
        </p>
        <LanguageSwitch />
      </div>
      <ScreenTitle title={title} />
      <div className="panel flex flex-col gap-4 p-5">{children}</div>
    </main>
  );
}

/** The one line under a form after a failed step. A screen reader reads it at once. */
export function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return <p role="alert" className="text-footnote text-late">{text}</p>;
}

/** A quiet text link under a form, for example Back to sign in. */
export const QUIET_LINK = 'pressable inline-flex min-h-11 items-center self-start rounded-full text-subheadline font-medium text-link';
